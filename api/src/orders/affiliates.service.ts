import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  defaultCommissionBps,
  normalizeAffiliateCode,
  suggestAffiliateCode,
} from './commission';
import { CreateAffiliateDto, MarkAffiliatePaidDto } from './dto';

const PAID_LIKE: OrderStatus[] = [
  'PAID',
  'PLOTTING',
  'PRINTING',
  'PACKED',
  'SHIPPED',
];

@Injectable()
export class AffiliatesService {
  constructor(private readonly prisma: PrismaService) {}

  private webOrigin(): string {
    return (
      process.env.PUBLIC_WEB_URL ||
      process.env.WEB_ORIGIN ||
      'http://localhost:5173'
    ).replace(/\/$/, '');
  }

  referralUrl(code: string): string {
    return `${this.webOrigin()}/?ref=${encodeURIComponent(code)}`;
  }

  /** Public lookup for guest UI after scanning QR. */
  async resolvePublic(code: string) {
    const normalized = normalizeAffiliateCode(code);
    if (!normalized) throw new NotFoundException('Affiliate not found');
    const aff = await this.prisma.affiliate.findUnique({
      where: { code: normalized },
    });
    if (!aff || !aff.active) throw new NotFoundException('Affiliate not found');
    return {
      code: aff.code,
      name: aff.name,
      boatName: aff.boatName,
      referralUrl: this.referralUrl(aff.code),
    };
  }

  async create(dto: CreateAffiliateDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('name is required');

    let code = dto.code
      ? normalizeAffiliateCode(dto.code)
      : suggestAffiliateCode(name);
    if (!code || code.length < 3) {
      throw new BadRequestException('code must be at least 3 characters');
    }

    const existing = await this.prisma.affiliate.findUnique({ where: { code } });
    if (existing) {
      if (dto.code) {
        throw new BadRequestException(`Code "${code}" is already in use`);
      }
      code = suggestAffiliateCode(name);
    }

    const commissionBps =
      dto.commissionBps != null
        ? Math.max(0, Math.min(5000, Math.round(dto.commissionBps)))
        : defaultCommissionBps();

    const aff = await this.prisma.affiliate.create({
      data: {
        code,
        name,
        email: dto.email?.trim() || undefined,
        boatName: dto.boatName?.trim() || undefined,
        commissionBps,
        note: dto.note?.trim() || undefined,
        active: dto.active ?? true,
      },
    });

    return this.toOperatorAffiliate(aff, { owedCents: 0, paidCents: 0, orderCount: 0 });
  }

  async list() {
    const affiliates = await this.prisma.affiliate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const summaries = await Promise.all(
      affiliates.map(async (aff) => {
        const orders = await this.prisma.order.findMany({
          where: {
            affiliateId: aff.id,
            status: { in: PAID_LIKE },
            commissionCents: { gt: 0 },
          },
          select: { commissionCents: true, commissionPaidAt: true },
        });
        let owedCents = 0;
        let paidCents = 0;
        for (const o of orders) {
          const c = o.commissionCents ?? 0;
          if (o.commissionPaidAt) paidCents += c;
          else owedCents += c;
        }
        return this.toOperatorAffiliate(aff, {
          owedCents,
          paidCents,
          orderCount: orders.length,
        });
      }),
    );

    return {
      affiliates: summaries,
      totalOwedCents: summaries.reduce((s, a) => s + a.owedCents, 0),
    };
  }

  async markPaid(affiliateId: string, dto: MarkAffiliatePaidDto) {
    const aff = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
    });
    if (!aff) throw new NotFoundException('Affiliate not found');

    const where: Prisma.OrderWhereInput = {
      affiliateId,
      status: { in: PAID_LIKE },
      commissionCents: { gt: 0 },
      commissionPaidAt: null,
    };
    if (dto.orderIds?.length) {
      where.id = { in: dto.orderIds };
    }

    const result = await this.prisma.order.updateMany({
      where,
      data: { commissionPaidAt: new Date() },
    });

    return { affiliateId, marked: result.count };
  }

  async findActiveByCode(code: string | null | undefined) {
    if (!code) return null;
    const normalized = normalizeAffiliateCode(code);
    if (!normalized) return null;
    return this.prisma.affiliate.findFirst({
      where: { code: normalized, active: true },
    });
  }

  private toOperatorAffiliate(
    aff: {
      id: string;
      code: string;
      name: string;
      email: string | null;
      boatName: string | null;
      commissionBps: number;
      active: boolean;
      note: string | null;
      createdAt: Date;
    },
    stats: { owedCents: number; paidCents: number; orderCount: number },
  ) {
    const referralUrl = this.referralUrl(aff.code);
    return {
      id: aff.id,
      code: aff.code,
      name: aff.name,
      email: aff.email,
      boatName: aff.boatName,
      commissionBps: aff.commissionBps,
      commissionPercent: aff.commissionBps / 100,
      active: aff.active,
      note: aff.note,
      createdAt: aff.createdAt,
      referralUrl,
      qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(referralUrl)}`,
      owedCents: stats.owedCents,
      paidCents: stats.paidCents,
      orderCount: stats.orderCount,
    };
  }
}
