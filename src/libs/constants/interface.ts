import { tokenType } from 'src/common/enums';

export interface TokenPayload {
  sub: string;
  email?: string;
  username?: string;
  tokenType: tokenType;
  roles: string[];
  jti?: string;
  iat?: number;
  exp?: number;
}


