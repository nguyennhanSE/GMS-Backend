import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LogoutDto,
  RefreshTokenRequestDto,
  RegisterMemberDto,
} from './dto/auth.dto';
import { Public } from 'src/libs/decorator/public.decorator';
import { ResponseModel } from 'src/libs/models/response/response.model';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { toResponse } from '../user/mapper/user.mapper';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'Public member self-registration with email verification',
  })
  @ApiResponse({
    status: 201,
    description:
      'Member account created in pending_verification status and verification email sent',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation error or user already exists',
  })
  async register(@Body() registerMemberDto: RegisterMemberDto) {
    const responseModel = new ResponseModel();
    const result = await this.authService.registerMember(registerMemberDto);
    responseModel.setData(toResponse(result));
    return responseModel;
  }

  @Post('login')
  @Public()
  async login(@Body() loginDto: LoginDto) {
    const responseModel = new ResponseModel();
    const result = await this.authService.login(loginDto);
    responseModel.setData(result);
    return responseModel;
  }

  @Post('logout')
  @Public()
  async logout(@Body() logoutDto: LogoutDto) {
    const responseModel = new ResponseModel();
    const result = await this.authService.logout(logoutDto);
    responseModel.setData(result);
    return responseModel;
  }

  @Post('refresh-token')
  @Public()
  async refreshToken(@Body() refreshTokenDto: RefreshTokenRequestDto) {
    const responseModel = new ResponseModel();
    const result = await this.authService.refreshToken(refreshTokenDto);
    responseModel.setData(result);
    return responseModel;
  }
}
