import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from "@nestjs/common";
import type { JwtSignOptions } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import {
    LoginDto,
    LogoutDto,
    RefreshTokenRequestDto,
    RegisterMemberDto,
} from "./dto/auth.dto";
import { TokenPayload } from "../../libs/constants/interface";
import { tokenType } from "src/common/enums";
import { config } from "src/libs/config";
import { RolesService } from "../roles/roles.service";
import { AuthRepository } from "./repositories/auth.repository";
import { comparePassword } from "src/utils/encrypt";
import { UserService } from "../user/user.service";
import { AppLogger } from "src/libs/logger";

type JwtExpiresIn = NonNullable<JwtSignOptions["expiresIn"]>;

@Injectable()
export class AuthService {
    private readonly errorCode: string;
    private readonly context = AuthService.name;

    constructor(
        private readonly authRepository: AuthRepository,
        private readonly userService: UserService,
        private readonly roleService: RolesService,
        private readonly logger: AppLogger,
    ) {
        this.errorCode = this.context;
    }

    private logCaughtError(operation: string, err: unknown): void {
        if (err instanceof UnauthorizedException || err instanceof BadRequestException || err instanceof NotFoundException) {
            this.logger.warn(`[${this.context}] ${operation} failed`, err);
            return;
        }

        this.logger.error(`[${this.context}] ${operation} failed`, err);
    }

    private async decodeRefreshTokenOrThrow(refreshToken: string): Promise<TokenPayload> {
        try {
            return await this.authRepository.decodeToken(refreshToken, {
                secret: config.JWT_SECRET_REFRESH_TOKEN,
            });
        } catch {
            throw new UnauthorizedException("Invalid refresh token");
        }
    }

    private buildJwtSignOptions(secret: string, expiresIn: string): JwtSignOptions {
        return {
            secret,
            expiresIn: this.parseJwtExpiresIn(expiresIn),
        };
    }

    private parseJwtExpiresIn(expiresIn: string): JwtExpiresIn {
        return expiresIn as JwtExpiresIn;
    }

    private buildRefreshTokenPayload(
        userId: string,
        username: string,
        email: string,
        roles: string[],
    ): TokenPayload {
        return {
            sub: userId,
            tokenType: tokenType.RefreshToken,
            username,
            email,
            roles,
            jti: randomUUID(),
        };
    }

    async registerMember(dto: RegisterMemberDto) {
        this.logger.debug(`[${this.context}] registerMember start`, {
            email: dto.email,
        });
        try {
            return await this.userService.registerMember(dto);
        } catch (err) {
            this.logCaughtError('registerMember', err);
            throw err;
        }
    }

    // Login
    async login(dto: LoginDto) {
        this.logger.debug(`[${this.context}] login start`, dto);
        try {
            const { username: account, password, rememberMe, ip } = dto;

            if (!account) {
                throw new BadRequestException("Username is required");
            }

            const user = await this.userService.getUserByEmail(account);
            this.logger.debug(`[${this.context}] login user fetched`, { account, user });
            if (!user) {
                throw new BadRequestException("User not exist");
            }

            if (user.status !== 'active') {
                throw new UnauthorizedException("Account is inactive or banned");
            }

            if (password) {
                if (!user.password) {
                    throw new UnauthorizedException("Invalid credentials");
                }
                const ok = await comparePassword(password, user.password);
                this.logger.debug(`[${this.context}] login compare password`, { account, ok });
                if (!ok) {
                    throw new UnauthorizedException("Invalid credentials");
                }
            }

            const roles = await this.roleService.getUserRoles(user.id);

            const accessTokenPayload: TokenPayload = {
                sub: user.id,
                tokenType: tokenType.AccessToken,
                username: user.id,
                email: user.email,
                roles
            }; 
            const refreshTokenPayload = this.buildRefreshTokenPayload(
                user.id,
                user.id,
                user.email,
                roles,
            );

            const refreshExpiry = rememberMe
                ? config.REFRESH_TOKEN_REMEMBER_EXPIRES_IN
                : config.REFRESH_TOKEN_EXPIRES_IN;
            const accessTokenOptions = this.buildJwtSignOptions(
                config.JWT_SECRET_ACCESS_TOKEN,
                config.ACCESS_TOKEN_EXPIRES_IN,
            );
            const refreshTokenOptions = this.buildJwtSignOptions(
                config.JWT_SECRET_REFRESH_TOKEN,
                refreshExpiry,
            );

            const [accessToken, refreshToken] = await Promise.all([
                this.authRepository.generateToken(accessTokenPayload, accessTokenOptions),
                this.authRepository.generateToken(refreshTokenPayload, refreshTokenOptions),
            ]);

            this.logger.debug(`[${this.context}] login tokens issued`, {
                account,
                accessToken,
                refreshToken,
                rememberMe,
                ip,
            });

            if (refreshToken) {
                const stored = await this.authRepository.storeToken(
                    refreshToken,
                    { secret: config.JWT_SECRET_REFRESH_TOKEN },
                    ip,
                );
                this.logger.debug(`[${this.context}] login refresh token stored`, { stored });
            }

            this.logger.debug(`[${this.context}] login done`, { account });
            return { 
                user: { 
                    email: user.email, 
                    name: `${user.firstName} ${user.lastName}`.trim(), 
                    id: user.id, 
                    account: account
                }, 
                accessToken, 
                refreshToken 
            };
        } catch (err) {
            this.logCaughtError('login', err);
            throw err;
        }
    }

    // logout
    async logout(dto: LogoutDto) {
        this.logger.debug(`[${this.context}] logout start`, dto);
        try {
            const { refreshToken } = dto;
            if (!refreshToken) {
                throw new BadRequestException("Missing refresh token");
            }

            const foundSession = await this.authRepository.findToken(refreshToken);
            this.logger.debug(`[${this.context}] logout found session`, { foundSession });

            if (!foundSession) {
                throw new UnauthorizedException("Your session is out. Please login again");
            }

            await this.authRepository.deleteToken(refreshToken);
            this.logger.debug(`[${this.context}] logout done`, { refreshToken });
            return { success: true };
        } catch (err) {
            this.logCaughtError('logout', err);
            throw err;
        }
    }

    // refresh token
    async refreshToken(dto: RefreshTokenRequestDto) {
        this.logger.debug(`[${this.context}] refreshToken start`, dto);
        try {
            const { refreshToken, ip } = dto;
            if (!refreshToken) {
                throw new BadRequestException("Missing refresh token");
            }
            // check refresh token used
            const isRefreshTokenUsed = await this.authRepository.isRefreshTokenUsed(refreshToken)
            if (isRefreshTokenUsed) {
                const decoded = await this.decodeRefreshTokenOrThrow(refreshToken)
                await this.authRepository.removeAllSessionOfUser(decoded.sub)
                throw new UnauthorizedException("Refresh token already used!! Please login again")
            }
            const decoded = await this.decodeRefreshTokenOrThrow(refreshToken);
            this.logger.debug(`[${this.context}] refreshToken decoded`, decoded);

            if (!decoded) {
                throw new UnauthorizedException("Error when refresh token! Please login again");
            }

            const { sub, username, email } = decoded;

            const availableToken = await this.authRepository.findToken(refreshToken);
            this.logger.debug(`[${this.context}] refreshToken in store`, { availableToken });

            if (!availableToken) {
                throw new NotFoundException("Session not found");
            }

            const user = username 
                ? await this.userService.getUserByAccount(username)
                : email 
                    ? await this.userService.getUserByEmail(email)
                    : null;
            this.logger.debug(`[${this.context}] refreshToken user fetched`, { user });
            if (!user) {
                throw new NotFoundException("User not found");
            }

            if (user.status !== 'active') {
                await this.authRepository.removeAllSessionOfUser(sub);
                throw new UnauthorizedException("Account is inactive or banned");
            }
            const roles = await this.roleService.getUserRoles(user.id);

            const accessTokenPayload: TokenPayload = {
                sub,
                tokenType: tokenType.AccessToken,
                username: username || user.id,
                email: user.email,
                roles
            };
            const refreshTokenPayload = this.buildRefreshTokenPayload(
                sub,
                username || user.id,
                user.email,
                roles,
            );
            const accessTokenOptions = this.buildJwtSignOptions(
                config.JWT_SECRET_ACCESS_TOKEN,
                config.ACCESS_TOKEN_EXPIRES_IN,
            );
            const refreshTokenOptions = this.buildJwtSignOptions(
                config.JWT_SECRET_REFRESH_TOKEN,
                config.REFRESH_TOKEN_EXPIRES_IN,
            );

            const [accessToken, newRefreshToken] = await Promise.all([
                this.authRepository.generateToken(accessTokenPayload, accessTokenOptions),
                this.authRepository.generateToken(refreshTokenPayload, refreshTokenOptions),
            ]);

            this.logger.debug(`[${this.context}] refreshToken new tokens`, {
                accessToken,
                newRefreshToken,
            });

            if (newRefreshToken) {
                const stored = await this.authRepository.updateToken(
                    newRefreshToken,
                    { secret: config.JWT_SECRET_REFRESH_TOKEN },
                    availableToken.id,
                    ip
                );
                this.logger.debug(`[${this.context}] refreshToken stored new RT`, { stored });
            }
            // add refresh token used 

            await this.authRepository.markRefreshTokenUsed(refreshToken, availableToken.id)
            this.logger.debug(`[${this.context}] refreshToken used`, { refreshToken });
            this.logger.debug(`[${this.context}] refreshToken done`, { userId: sub });
            return { accessToken, newRefreshToken };
        } catch (err) {
            this.logCaughtError('refreshToken', err);
            throw err;
        }
    }

    /**
     * OAuth login (e.g. Kakao): issue access/refresh tokens for an existing userId
     * and store refresh token as a session.
     */
    async oauthLogin(userId: string, email: string, ip?: string): Promise<any> {
        this.logger.debug(`[${this.context}] oauthLogin start`, { userId, email, ip });
        try {
            const user = await this.userService.getUserByAccount(userId);
            if (!user) {
                throw new NotFoundException("User not found");
            }

            const roles = await this.roleService.getUserRoles(user.id);

            const accessTokenPayload: TokenPayload = {
                sub: user.id,
                tokenType: tokenType.AccessToken,
                username: user.id,
                email: email || user.email,
                roles,
            };
            const refreshTokenPayload = this.buildRefreshTokenPayload(
                user.id,
                user.id,
                email || user.email,
                roles,
            );
            const accessTokenOptions = this.buildJwtSignOptions(
                config.JWT_SECRET_ACCESS_TOKEN,
                config.ACCESS_TOKEN_EXPIRES_IN,
            );
            const refreshTokenOptions = this.buildJwtSignOptions(
                config.JWT_SECRET_REFRESH_TOKEN,
                config.REFRESH_TOKEN_EXPIRES_IN,
            );
            const [accessToken, refreshToken] = await Promise.all([
                this.authRepository.generateToken(accessTokenPayload, accessTokenOptions),
                this.authRepository.generateToken(refreshTokenPayload, refreshTokenOptions),
            ]);

            if (refreshToken) {
                await this.authRepository.storeToken(
                    refreshToken,
                    { secret: config.JWT_SECRET_REFRESH_TOKEN },
                    ip,
                );
            }

            return {
                user: {
                    email: user.email,
                    name: `${user.firstName} ${user.lastName}`.trim(),
                    id: user.id,
                    account: user.id,
                },
                accessToken,
                refreshToken,
            };
        } catch (err) {
            this.logCaughtError('oauthLogin', err);
            throw err;
        }
    }
}
