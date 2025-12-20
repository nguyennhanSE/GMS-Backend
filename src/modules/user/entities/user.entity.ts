export class UserEntity {
  id!: string;
  password?: string | null;

  firstName!: string;
  lastName!: string;
  email!: string;

  phone?: string | null;
  gender?: string | null;
  dob?: Date | null;
  address?: string | null;
  status?: string | null;

  createdAt?: Date | null;

  roles?: RoleInfo[];
  memberships?: MembershipInfo[];

}

export class RoleInfo {
  id!: string;
  name!: string;
  description?: string | null;
}

export class MembershipInfo {
  id!: string;
  name!: string;
  description?: string | null;
}