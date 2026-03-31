import { Prisma, TrainerClientLinkStatus } from '@prisma/client';

type TrainerClientLinkUserView = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

type TrainerClientLinkWithRelations = Prisma.TrainerClientLinkGetPayload<{
  include: {
    trainer: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        email: true;
      };
    };
    member: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        email: true;
      };
    };
  };
}>;

export type TrainerClientLinkView = {
  id: string;
  trainerId: string;
  memberId: string;
  status: TrainerClientLinkStatus;
  linkedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  createdAt: Date;
  trainer: TrainerClientLinkUserView;
  member: TrainerClientLinkUserView;
};

export function toTrainerClientLinkView(
  link: TrainerClientLinkWithRelations,
): TrainerClientLinkView {
  return {
    id: link.id,
    trainerId: link.trainerId,
    memberId: link.memberId,
    status: link.status,
    linkedAt: link.linkedAt,
    endedAt: link.endedAt ?? null,
    endReason: link.endReason ?? null,
    createdAt: link.createdAt,
    trainer: {
      id: link.trainer.id,
      firstName: link.trainer.firstName,
      lastName: link.trainer.lastName,
      email: link.trainer.email,
    },
    member: {
      id: link.member.id,
      firstName: link.member.firstName,
      lastName: link.member.lastName,
      email: link.member.email,
    },
  };
}
