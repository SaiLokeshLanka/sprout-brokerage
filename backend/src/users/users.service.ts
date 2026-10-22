import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from './user.mapper';
import { KycDto, UpdateProfileDto } from './users.dto';

const MIN_AGE = 18;

function ageInYears(dob: Date, now = new Date()) {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    return toPublicUser(await this.findById(userId));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return toPublicUser(user);
  }

  /** Simulated KYC: validates PAN + age and verifies instantly (a real broker would call a KYC provider). */
  async submitKyc(userId: string, dto: KycDto) {
    const user = await this.findById(userId);
    if (user.kycStatus === 'VERIFIED') throw new ConflictException('KYC is already verified');

    const dob = new Date(`${dto.dateOfBirth}T00:00:00Z`);
    // Round-trip check rejects impossible dates like 2001-02-30.
    if (Number.isNaN(dob.getTime()) || dob.toISOString().slice(0, 10) !== dto.dateOfBirth) {
      throw new BadRequestException('Enter a valid date of birth');
    }
    const age = ageInYears(dob);
    if (age < 0 || age > 120) throw new BadRequestException('Enter a valid date of birth');
    if (age < MIN_AGE) throw new BadRequestException(`You must be at least ${MIN_AGE} years old to invest`);

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { pan: dto.pan, dateOfBirth: dob, kycStatus: 'VERIFIED', kycVerifiedAt: new Date() },
      });
      return toPublicUser(updated);
    } catch (err) {
      if (isUniqueViolation(err, 'pan')) throw new ConflictException('This PAN is already linked to another account');
      throw err;
    }
  }

  private async findById(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
