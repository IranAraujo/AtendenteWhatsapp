// @ts-nocheck
import { PrismaClient, Role, AppointmentStatus } from '@prisma/client';
export interface DbServiceItem {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  durationMinutes: number;
  description?: string;
  bufferTimeMinutes?: number; // Folga/Intervalo após o serviço
}

export interface DbProductItem {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  stock: number;
  description?: string;
}

export interface DbProfessionalWorkSchedule {
  startTime: string;       // "08:00"
  endTime: string;         // "18:00"
  lunchStartTime?: string | null; // "12:00"
  lunchEndTime?: string | null;   // "13:00"
  workDays?: number[];     // [1, 2, 3, 4, 5, 6] (0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb)
}

export interface DbProfessionalItem {
  id: string;
  tenantId: string;
  name: string;
  userId?: string;
  servicesHandled?: string[]; // Array de IDs de serviços atendidos. Se vazio/undefined, atende todos.
  workSchedule?: DbProfessionalWorkSchedule;
  phone?: string;                 // WhatsApp number for notifications
  maxAppointmentsPerDay?: number; // daily limit, undefined = no limit
}

export interface DbTenantRemindersConfig {
  enable24hReminder: boolean;
  custom24hText?: string;
  enable1hReminder: boolean;
  custom1hText?: string;
}

export interface DbAppointmentItem {
  id: string;
  tenantId: string;
  professionalId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  startTime: Date;
  endTime: Date;
  status: 'PENDING' | 'CONFIRMED' | 'PENDING_PAYMENT' | 'CANCELLED' | 'COMPLETED';
  pixQrCode?: string;
  reminder24hSent?: boolean;
  reminder1hSent?: boolean;
}

export interface DbCustomerProfile {
  phone: string;          // clean phone (digits only)
  tenantId: string;
  name?: string;
  preferredProfId?: string;
  preferredServiceId?: string;
  visitCount: number;
  lastVisitDate?: string; // 'YYYY-MM-DD'
}

export interface DbWaitlistItem {
  id: string;
  tenantId: string;
  customerPhone: string;
  customerName: string;
  professionalId?: string;
  serviceId?: string;
  dateStr: string;   // 'YYYY-MM-DD' - preferred date
  createdAt: string; // ISO string
}

export interface DbScheduleBlock {
  id: string;
  tenantId: string;
  professionalId: string;
  dateStr: string;       // 'YYYY-MM-DD'
  startTime?: string;    // 'HH:mm' - null means full day block
  endTime?: string;      // 'HH:mm'
  reason?: string;       // 'Folga', 'Feriado', etc.
}

export interface DbBookingRulesConfig {
  bufferTimeMinutes?: number;      // 0, 5, 10, 15, 30 min (default 10)
  minimumNoticeMinutes?: number;   // 0, 30, 60, 120 min (default 60)
  maxFutureDays?: number;          // 15, 30, 60, 90 dias (default 30)
  roundRobinEnabled?: boolean;     // true/false (default true)
  webhookUrl?: string;             // URL externa para envio de webhooks
}

export interface DbTenantUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'SUPER_ADMIN';
  professionalId?: string;
}

export interface DbTenantItem {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  planTier: 'FREE' | 'SINGLE_USER' | 'MULTI_USER';
  maxUsers: number;
  status: 'ACTIVE' | 'SUSPENDED';
  aiConfig: {
    systemPrompt: string;
    businessInfo: string;
    faqItems?: Array<{ question: string; answer: string }>;
    voiceId?: string;
    voiceReplyMode?: 'ALWAYS' | 'WHEN_AUDIO_RECEIVED' | 'NEVER';
  };
  bookingRules?: DbBookingRulesConfig;
  remindersConfig?: DbTenantRemindersConfig;
  users: DbTenantUser[];
}


import { hashPassword } from './auth.service.js';

export const prisma = new PrismaClient();

class DbRepository {
  
  // ============================================
  // TENANTS E PLANOS
  // ============================================
  
  async getAllTenants(): Promise<any> {
    return prisma.tenant.findMany({
      include: { users: true }
    });
  }

  async getTenantById(id: string): Promise<any> {
    return prisma.tenant.findUnique({
      where: { id },
      include: {
        users: true,
        aiConfig: true
      }
    });
  }

  async updateTenantPlan(tenantId: string, planTier: string) {
    const maxUsers = planTier === 'FREE' || planTier === 'SINGLE_USER' ? 1 : 5;
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { planTier, maxUsers }
    });
    return { success: true, maxUsers: updated.maxUsers };
  }

  async updateTenantProfile(tenantId: string, profile: { name?: string; slug?: string }) {
    const data: any = {};
    if (profile.name && profile.name.trim()) data.name = profile.name.trim();
    if (profile.slug && profile.slug.trim()) {
      const cleanSlug = profile.slug.toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (cleanSlug) {
        // Check uniqueness for other tenants
        const existing = await prisma.tenant.findFirst({
          where: { slug: cleanSlug, NOT: { id: tenantId } }
        });
        if (!existing) {
          data.slug = cleanSlug;
        }
      }
    }
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data
    });
    return updated;
  }

  async saveTenant(tenantData: any): Promise<any> {
    // This is used for aiConfig updates currently.
    if (tenantData.aiConfig) {
      await prisma.aiConfig.upsert({
        where: { tenantId: tenantData.id },
        update: {
          systemPrompt: tenantData.aiConfig.systemPrompt,
          businessInfo: tenantData.aiConfig.businessInfo,
          faqItems: tenantData.aiConfig.faqItems,
          voiceId: tenantData.aiConfig.voiceId,
          voiceReplyMode: tenantData.aiConfig.voiceReplyMode
        },
        create: {
          tenantId: tenantData.id,
          systemPrompt: tenantData.aiConfig.systemPrompt || '',
          businessInfo: tenantData.aiConfig.businessInfo || '',
          faqItems: tenantData.aiConfig.faqItems || [],
          voiceId: tenantData.aiConfig.voiceId,
          voiceReplyMode: tenantData.aiConfig.voiceReplyMode || 'NEVER'
        }
      });
    }
    return this.getTenantById(tenantData.id) as unknown as Promise<DbTenantItem>;
  }

  // ============================================
  // CADASTRO (REGISTER)
  // ============================================
  
  async registerTenantAndOwner(data: any) {
    // Basic validations inside a transaction
    return prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({ where: { email: data.email } });
      if (existingUser) throw new Error('Email já está em uso.');

      let baseSlug = (data.companyName || 'empresa')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      if (!baseSlug) baseSlug = 'empresa';

      const existingSlug = await tx.tenant.findUnique({ where: { slug: baseSlug } });
      const finalSlug = existingSlug ? `${baseSlug}-${Date.now().toString().slice(-4)}` : baseSlug;

      const maxUsers = data.planTier === 'SINGLE_USER' || data.planTier === 'FREE' ? 1 : 5;

      const tenant = await tx.tenant.create({
        data: {
          name: data.companyName,
          slug: finalSlug,
          planTier: data.planTier,
          ownerEmail: data.email,
          maxUsers,
          aiConfig: {
            create: {
              systemPrompt: 'Profissional e educada.',
              businessInfo: 'Clínica Padrão'
            }
          }
        }
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: data.ownerName,
          email: data.email,
          passwordHash: hashPassword(data.password),
          role: Role.OWNER,
          isEmailVerified: data.isEmailVerified ?? false,
          verificationCode: data.verificationCode || null,
          verificationToken: data.verificationToken || null,
          verificationExpires: data.verificationExpires || null
        }
      });

      const professional = await tx.professional.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          name: data.ownerName,
          phone: data.phone
        }
      });

      const defaultServices = [
        { tenantId: tenant.id, name: 'Serviço Padrão', price: 50.00, durationMinutes: 30 }
      ];

      await tx.service.createMany({ data: defaultServices });
      
      const services = await tx.service.findMany({ where: { tenantId: tenant.id } });

      return {
        tenant,
        user: { ...user, professionalId: professional.id },
        initialProfessional: professional,
        initialServices: services
      };
    });
  }

  // ============================================
  // USUÁRIOS E AUTENTICAÇÃO
  // ============================================

  async findUserByEmail(email: string) {
    if (!email) return undefined;
    const cleanEmail = email.trim();
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: cleanEmail,
          mode: 'insensitive'
        }
      },
      include: { tenant: true, professional: true }
    });
    if (!user) return undefined;
    return { user: { ...user, professionalId: user.professional?.id }, tenant: user.tenant };
  }

  async findUserById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { tenant: true, professional: true }
    });
    if (!user) return undefined;
    return { user: { ...user, professionalId: user.professional?.id }, tenant: user.tenant };
  }

  async updateUserPassword(userId: string, newHash: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { 
        passwordHash: newHash,
        resetPasswordToken: null,
        resetPasswordExpires: null
      }
    });
  }

  async findUserByVerificationToken(token: string) {
    if (!token) return undefined;
    const user = await prisma.user.findFirst({
      where: { verificationToken: token },
      include: { tenant: true, professional: true }
    });
    if (!user) return undefined;
    return { user: { ...user, professionalId: user.professional?.id }, tenant: user.tenant };
  }

  async findUserByVerificationCode(email: string, code: string) {
    if (!email || !code) return undefined;
    const cleanEmail = email.trim();
    const cleanCode = code.trim();
    const user = await prisma.user.findFirst({
      where: {
        email: { equals: cleanEmail, mode: 'insensitive' },
        verificationCode: cleanCode
      },
      include: { tenant: true, professional: true }
    });
    if (!user) return undefined;
    return { user: { ...user, professionalId: user.professional?.id }, tenant: user.tenant };
  }

  async confirmUserEmail(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        isEmailVerified: true,
        verificationCode: null,
        verificationToken: null,
        verificationExpires: null
      }
    });
  }

  async updateEmailVerification(email: string, code: string, token: string, expires: Date) {
    const cleanEmail = email.trim();
    return prisma.user.updateMany({
      where: { email: { equals: cleanEmail, mode: 'insensitive' } },
      data: {
        verificationCode: code,
        verificationToken: token,
        verificationExpires: expires
      }
    });
  }

  async setPasswordResetToken(email: string, token: string, expires: Date) {
    const cleanEmail = email.trim();
    return prisma.user.updateMany({
      where: { email: { equals: cleanEmail, mode: 'insensitive' } },
      data: {
        resetPasswordToken: token,
        resetPasswordExpires: expires
      }
    });
  }

  async findUserByResetToken(token: string) {
    if (!token) return undefined;
    const user = await prisma.user.findFirst({
      where: { 
        resetPasswordToken: token,
        resetPasswordExpires: { gte: new Date() }
      },
      include: { tenant: true, professional: true }
    });
    if (!user) return undefined;
    return { user: { ...user, professionalId: user.professional?.id }, tenant: user.tenant };
  }

  async addUserToTenant(tenantId: string, data: any) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { _count: { select: { users: true } } } });
    if (!tenant) return { success: false, message: 'Tenant não encontrado.' };
    
    if (tenant._count.users >= tenant.maxUsers) {
      return { success: false, message: `Limite de usuários excedido (${tenant.maxUsers}).` };
    }

    const existing = await prisma.user.findFirst({ where: { email: data.email, tenantId } });
    if (existing) return { success: false, message: 'Email já cadastrado neste estabelecimento.' };

    const user = await prisma.user.create({
      data: {
        tenantId,
        name: data.name,
        email: data.email,
        passwordHash: hashPassword(data.passwordHash),
        role: data.role as Role,
        isEmailVerified: true
      }
    });

    if (data.role === 'PROFESSIONAL' || data.role === 'OWNER') {
      await prisma.professional.create({
        data: {
          tenantId,
          userId: user.id,
          name: data.name
        }
      });
    }

    return { success: true, user };
  }

  async updateUserInTenant(tenantId: string, userId: string, data: any) {
    const updateData: any = { name: data.name, email: data.email };
    if (data.role) updateData.role = data.role as Role;
    if (data.password) updateData.passwordHash = hashPassword(data.password);

    const user = await prisma.user.update({
      where: { id: userId, tenantId },
      data: updateData
    });
    return { success: true, user };
  }

  async deleteUserFromTenant(tenantId: string, userId: string) {
    await prisma.user.delete({ where: { id: userId, tenantId } });
    return true;
  }

  // ============================================
  // PROFISSIONAIS E SERVIÇOS
  // ============================================

  async listProfessionals(tenantId: string, serviceId?: string): Promise<any> {
    let whereClause: any = { tenantId };
    if (serviceId) {
       // Filter professionals that handle this service (empty array means handles all)
       // Prisma doesn't have a simple "array contains OR array is empty" without raw queries,
       // we will fetch all and filter in memory for now to keep it simple.
    }
    const profs = await prisma.professional.findMany({ where: whereClause });
    if (serviceId) {
      return profs.filter(p => !p.servicesHandled || p.servicesHandled.length === 0 || p.servicesHandled.includes(serviceId));
    }
    return profs as unknown as DbProfessionalItem[];
  }

  async updateProfessional(tenantId: string, profId: string, data: any) {
    return prisma.professional.update({
      where: { id: profId, tenantId },
      data
    });
  }

  async listServices(tenantId: string): Promise<any> {
    const s = await prisma.service.findMany({ where: { tenantId } }); 
    return s.map(x => ({...x, price: Number(x.price)})) as unknown as DbServiceItem[];
  }

  async addService(tenantId: string, data: any) {
    const created = await prisma.service.create({
      data: {
        tenantId,
        name: data.name,
        price: data.price,
        durationMinutes: data.durationMinutes || 30,
        description: data.description || '',
        bufferTimeMins: data.bufferTimeMinutes || 0
      }
    });
    return { ...created, price: Number(created.price) };
  }

  async updateService(tenantId: string, serviceId: string, updates: any) {
    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.price !== undefined) updateData.price = updates.price;
    if (updates.durationMinutes !== undefined) updateData.durationMinutes = updates.durationMinutes;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.bufferTimeMinutes !== undefined) updateData.bufferTimeMins = updates.bufferTimeMinutes;

    const updated = await prisma.service.update({
      where: { id: serviceId, tenantId },
      data: updateData
    });
    return { ...updated, price: Number(updated.price) };
  }

  async deleteService(tenantId: string, serviceId: string): Promise<boolean> {
    await prisma.service.delete({
      where: { id: serviceId, tenantId }
    });
    return true;
  }

  private products: DbProductItem[] = [];

  async listProducts(tenantId?: string): Promise<any[]> {
    try {
      if (!tenantId) {
        const prods = await prisma.product.findMany({ where: { active: true } });
        return prods.map(p => ({ ...p, price: Number(p.price) }));
      }
      const prods = await prisma.product.findMany({ where: { tenantId, active: true } });
      return prods.map(p => ({ ...p, price: Number(p.price) }));
    } catch {
      if (!tenantId) return this.products;
      return this.products.filter(p => p.tenantId === tenantId);
    }
  }

  async addProduct(tenantId: string, data: any): Promise<any> {
    try {
      const prod = await prisma.product.create({
        data: {
          tenantId,
          name: data.name,
          price: Number(data.price) || 0,
          stock: Number(data.stock) || 0,
          description: data.description || '',
          active: true
        }
      });
      return { ...prod, price: Number(prod.price) };
    } catch {
      const product: DbProductItem = {
        id: `prod-${Date.now()}`,
        tenantId,
        name: data.name,
        price: Number(data.price) || 0,
        stock: Number(data.stock) || 0,
        description: data.description || ''
      };
      this.products.push(product);
      return product;
    }
  }

  async updateProduct(tenantId: string, productId: string, updates: any): Promise<any> {
    try {
      const updateData: any = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.price !== undefined) updateData.price = Number(updates.price);
      if (updates.stock !== undefined) updateData.stock = Number(updates.stock);
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.active !== undefined) updateData.active = Boolean(updates.active);

      const prod = await prisma.product.update({
        where: { id: productId },
        data: updateData
      });
      return { ...prod, price: Number(prod.price) };
    } catch {
      const p = this.products.find(x => x.id === productId && x.tenantId === tenantId);
      if (!p) return undefined;
      if (updates.name !== undefined) p.name = updates.name;
      if (updates.price !== undefined) p.price = Number(updates.price);
      if (updates.stock !== undefined) p.stock = Number(updates.stock);
      if (updates.description !== undefined) p.description = updates.description;
      return p;
    }
  }

  async deleteProduct(tenantId: string, productId: string): Promise<boolean> {
    try {
      await prisma.product.delete({ where: { id: productId } });
      return true;
    } catch {
      const init = this.products.length;
      this.products = this.products.filter(x => !(x.id === productId && x.tenantId === tenantId));
      return this.products.length !== init;
    }
  }
  async getAllWaitlist(tenantId: string): Promise<any> { 
    return prisma.waitlist.findMany({ where: { tenantId } });
  }
  async removeFromWaitlist(waitlistId: string): Promise<any> { 
    await prisma.waitlist.delete({ where: { id: waitlistId } });
    return true;
  }
  async getScheduleBlocks(tenantId: string, professionalId?: string, dateStr?: string): Promise<any> {
    let where: any = { tenantId };
    if (professionalId) where.professionalId = professionalId;
    if (dateStr) {
      where.date = new Date(`${dateStr}T00:00:00.000Z`);
    }
    return prisma.scheduleBlock.findMany({ where });
  }
  async addScheduleBlock(data: any): Promise<any> {
    return prisma.scheduleBlock.create({
      data: {
        tenantId: data.tenantId,
        professionalId: data.professionalId,
        date: new Date(`${data.dateStr}T00:00:00.000Z`),
        startTime: data.startTime,
        endTime: data.endTime,
        reason: data.reason
      }
    });
  }
  async removeScheduleBlock(blockId: string): Promise<any> { 
    await prisma.scheduleBlock.delete({ where: { id: blockId } });
    return true;
  }
  async getAllAppointments(tenantId: string): Promise<any> { 
    return (await prisma.appointment.findMany({ where: { tenantId } })) as unknown as DbAppointmentItem[];
  }
  async getAppointmentsForProfessional(profId: string, dateStr: string): Promise<any> {
    const start = new Date(`${dateStr}T00:00:00-03:00`);
    const end = new Date(`${dateStr}T23:59:59.999-03:00`);
    return prisma.appointment.findMany({
      where: {
        professionalId: profId,
        startTime: { gte: start, lte: end }
      }
    });
  }
  async createAppointment(tenantIdOrData: any, dataObj?: any): Promise<any> {
    const data = dataObj || tenantIdOrData;
    const tenantId = dataObj ? tenantIdOrData : data.tenantId;
    return prisma.$transaction(async (tx) => {
      const startTime = new Date(data.startTime);
      const endTime = new Date(data.endTime);
      
      const overlapping = await tx.appointment.findFirst({
        where: {
          tenantId,
          professionalId: data.professionalId,
          status: { not: 'CANCELLED' },
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } }
          ]
        }
      });
      if (overlapping) throw new Error('Horário indisponível devido a conflito de agenda.');

      return tx.appointment.create({
        data: {
          tenantId,
          professionalId: data.professionalId,
          serviceId: data.serviceId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          startTime,
          endTime,
          status: data.status || 'PENDING'
        }
      });
    });
  }

  async updateAppointmentDetails(id: string, updates: any): Promise<any> {
    return prisma.appointment.update({ where: { id }, data: updates });
  }
  async getAppointmentById(id: string) { return prisma.appointment.findUnique({ where: { id } }); }
  async deleteAppointment(id: string) { 
    try {
      await prisma.appointment.delete({ where: { id } });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Extra methods needed by other services
  async findActiveAppointmentByPhone(tenantId: string, phone: string) {
    const cleanPhone = phone.replace(/\D/g, '');
    const apps = await prisma.appointment.findMany({
      where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] } }
    });
    const found = apps.find(a => a.customerPhone.replace(/\D/g, '') === cleanPhone);
    return found as unknown as DbAppointmentItem | undefined;
  }

  async cancelAppointmentByPhone(tenantId: string, phone: string): Promise<any> {
    const cleanPhone = phone.replace(/\D/g, '');
    const apps = await prisma.appointment.findMany({
      where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] } }
    });
    const found = apps.find(a => a.customerPhone.replace(/\D/g, '') === cleanPhone);
    if (found) {
      const updated = await prisma.appointment.update({ where: { id: found.id }, data: { status: 'CANCELLED' } });
      return updated;
    }
    return null;
  }

  async updateAppointmentTime(id: string, startTime: Date, endTime: Date): Promise<any> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id } });
      if (!existing) throw new Error('Agendamento não encontrado');

      const overlapping = await tx.appointment.findFirst({
        where: {
          tenantId: existing.tenantId,
          professionalId: existing.professionalId,
          id: { not: id },
          status: { not: 'CANCELLED' },
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } }
          ]
        }
      });
      if (overlapping) throw new Error('Horário indisponível devido a conflito de agenda.');

      return tx.appointment.update({ where: { id }, data: { startTime, endTime } });
    });
  }

  async addToWaitlist(data: any) {
    return prisma.waitlist.create({
      data: {
        tenantId: data.tenantId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        preferredDate: new Date(data.dateStr + 'T00:00:00.000Z'),
        professionalId: data.professionalId,
        serviceId: data.serviceId
      }
    });
  }

  async getCustomerProfile(tenantId: string, phone: string) {
    const cleanPhone = phone.replace(/\D/g, '');
    return prisma.customer.findUnique({ where: { tenantId_phone: { tenantId, phone: cleanPhone } } });
  }

  async markAppointmentReminderSent(id: string, type: '24h' | '1h') {
    if (type === '24h') await prisma.appointment.update({ where: { id }, data: { reminder24h: true } });
    if (type === '1h') await prisma.appointment.update({ where: { id }, data: { reminder1h: true } });
    return true;
  }

  async getWaitlistForDate(tenantId: string, dateStr: string, professionalId?: string) {
    const start = new Date(dateStr + 'T00:00:00.000Z');
    return prisma.waitlist.findMany({
      where: { tenantId, preferredDate: start, professionalId }
    });
  }

  async listAppointments(tenantId: string) {
    return this.getAllAppointments(tenantId);
  }

  async deleteTenant(id: string) {
    await prisma.tenant.delete({ where: { id } });
    return true;
  }

  async getDailyAppointmentCount(professionalId: string, dateStr: string): Promise<number> {
    const apps = await this.getAppointmentsForProfessional(professionalId, dateStr);
    return apps.filter((a: any) => a.status !== 'CANCELLED').length;
  }

  async getTenantDailyAppointmentLimit(tenantIdOrObj: any): Promise<number | undefined> {
    const id = typeof tenantIdOrObj === 'string' ? tenantIdOrObj : tenantIdOrObj?.id;
    if (!id) return undefined;
    const tenant = await this.getTenantById(id);
    return tenant?.bookingRules?.maxAppointmentsPerDay || undefined;
  }

  async getDailyAppointmentCountForTenant(tenantId: string, dateStr: string): Promise<number> {
    const apps = await this.getAllAppointments(tenantId);
    return apps.filter((a: any) => {
      const d = (a.startTime instanceof Date) ? a.startTime : new Date(a.startTime);
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).formatToParts(d);
      const y = parts.find(p => p.type === 'year')?.value;
      const m = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      return `${y}-${m}-${day}` === dateStr && a.status !== 'CANCELLED';
    }).length;
  }

  async incrementVisitCount(tenantId: string, customerPhone: string, professionalId?: string, serviceId?: string, customerName?: string): Promise<void> {
    try {
      const cleanPhone = customerPhone.replace(/\D/g, '');
      if (!cleanPhone) return;
      const existing = await prisma.customer.findUnique({
        where: { tenantId_phone: { tenantId, phone: cleanPhone } }
      });

      if (existing) {
        await prisma.customer.update({
          where: { tenantId_phone: { tenantId, phone: cleanPhone } },
          data: {
            visitCount: { increment: 1 },
            lastVisitDate: new Date(),
            ...(customerName && !existing.name && { name: customerName }),
            ...(professionalId && { preferredProfId: professionalId }),
            ...(serviceId && { preferredServiceId: serviceId })
          }
        });
      } else {
        await prisma.customer.create({
          data: {
            tenantId,
            phone: cleanPhone,
            name: customerName || null,
            visitCount: 1,
            lastVisitDate: new Date(),
            preferredProfId: professionalId || null,
            preferredServiceId: serviceId || null
          }
        });
      }
    } catch (e) {
      // Graceful fallback
    }
  }

  async listCustomers(tenantId: string): Promise<any[]> {
    const [dbCustomers, appts] = await Promise.all([
      prisma.customer.findMany({ where: { tenantId }, orderBy: { lastVisitDate: 'desc' } }),
      prisma.appointment.findMany({ where: { tenantId, status: { not: 'CANCELLED' } }, orderBy: { startTime: 'desc' } })
    ]);

    const map = new Map<string, any>();

    for (const c of dbCustomers) {
      const clean = c.phone.replace(/\D/g, '');
      if (!clean) continue;
      map.set(clean, {
        phone: clean,
        name: c.name || 'Cliente WhatsApp',
        visitCount: c.visitCount || 1,
        lastVisitDate: c.lastVisitDate ? c.lastVisitDate.toISOString() : null,
        preferredProfId: c.preferredProfId,
        preferredServiceId: c.preferredServiceId
      });
    }

    for (const a of appts) {
      const clean = (a.customerPhone || '').replace(/\D/g, '');
      if (!clean) continue;
      const existing = map.get(clean);
      if (!existing) {
        map.set(clean, {
          phone: clean,
          name: a.customerName || 'Cliente WhatsApp',
          visitCount: 1,
          lastVisitDate: a.startTime ? a.startTime.toISOString() : null,
          preferredProfId: a.professionalId,
          preferredServiceId: a.serviceId
        });
      } else {
        if ((!existing.name || existing.name === 'Cliente WhatsApp') && a.customerName) {
          existing.name = a.customerName;
        }
        if (!existing.lastVisitDate && a.startTime) {
          existing.lastVisitDate = a.startTime.toISOString();
        }
      }
    }

    return Array.from(map.values());
  }


  async getTenantBySlug(slug: string): Promise<any> {
    return prisma.tenant.findUnique({
      where: { slug },
      include: {
        users: true,
        aiConfig: true
      }
    });
  }

}

export const dbRepository = new DbRepository();
