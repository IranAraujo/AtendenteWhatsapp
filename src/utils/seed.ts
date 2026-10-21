import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function hash(pass: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(pass, salt);
}

export async function seedDatabase() {
  console.log('--- SEEDING/SYNCING ESSENTIAL DEMO & USER ACCOUNTS ---');
  
  const defaultPasswordHash = hash('123456');

  // 1. Iran Araujo (Main Admin / User)
  const iranEmail = 'iran.s.araujo@gmail.com';
  let iranTenant = await prisma.tenant.findFirst({ where: { ownerEmail: iranEmail } });
  if (!iranTenant) {
    iranTenant = await prisma.tenant.create({
      data: {
        name: 'Iran Org',
        slug: `iran-org-${Date.now()}`,
        planTier: 'MULTI_USER',
        ownerEmail: iranEmail,
        maxUsers: 5,
        aiConfig: {
          create: {
            systemPrompt: 'Você é a atendente virtual da Iran Org. Seja muito educada, ágil e prestativa.',
            businessInfo: 'Horário de funcionamento: Seg a Sex das 08:00 às 18:00.'
          }
        }
      }
    });
  }

  let iranUser = await prisma.user.findFirst({ where: { email: iranEmail } });
  if (!iranUser) {
    iranUser = await prisma.user.create({
      data: {
        tenantId: iranTenant.id,
        name: 'Iran Araújo',
        email: iranEmail,
        passwordHash: defaultPasswordHash,
        role: Role.OWNER
      }
    });
  } else {
    await prisma.user.update({
      where: { id: iranUser.id },
      data: { passwordHash: defaultPasswordHash }
    });
  }

  let iranProf = await prisma.professional.findFirst({ where: { tenantId: iranTenant.id } });
  if (!iranProf) {
    await prisma.professional.create({
      data: {
        tenantId: iranTenant.id,
        userId: iranUser.id,
        name: 'Iran Araújo',
        phone: '11999998888'
      }
    });
  }

  const iranServices = await prisma.service.findMany({ where: { tenantId: iranTenant.id } });
  if (iranServices.length === 0) {
    await prisma.service.createMany({
      data: [
        { tenantId: iranTenant.id, name: 'Atendimento Geral', price: 50.00, durationMinutes: 30 },
        { tenantId: iranTenant.id, name: 'Consultoria Especializada', price: 100.00, durationMinutes: 60 }
      ]
    });
  }

  // 2. Demo Account: Espaço Carlos Atendimentos
  const estiloEmail = 'dono@estilobeleza.com.br';
  let estiloTenant = await prisma.tenant.findFirst({ where: { ownerEmail: estiloEmail } });
  if (!estiloTenant) {
    estiloTenant = await prisma.tenant.create({
      data: {
        name: 'Espaço Carlos Atendimentos',
        slug: 'espaco-carlos-atendimentos',
        planTier: 'MULTI_USER',
        ownerEmail: estiloEmail,
        maxUsers: 5,
        aiConfig: {
          create: {
            systemPrompt: 'Você é a atendente inteligente do Espaço Carlos Atendimentos. Seja simpática e profissional.',
            businessInfo: 'Espaço Carlos Atendimentos. Aberto de Segunda a Sexta das 08h às 18h.'
          }
        }
      }
    });
  } else {
    await prisma.tenant.update({
      where: { id: estiloTenant.id },
      data: {
        name: 'Espaço Carlos Atendimentos',
        slug: 'espaco-carlos-atendimentos'
      }
    });
  }

  let estiloOwner = await prisma.user.findFirst({ where: { email: estiloEmail } });
  if (!estiloOwner) {
    estiloOwner = await prisma.user.create({
      data: {
        tenantId: estiloTenant.id,
        name: 'Carlos Dono',
        email: estiloEmail,
        passwordHash: defaultPasswordHash,
        role: Role.OWNER
      }
    });
  } else {
    await prisma.user.update({
      where: { id: estiloOwner.id },
      data: { passwordHash: defaultPasswordHash }
    });
  }

  let matheusUser = await prisma.user.findFirst({ where: { email: 'matheus@estilobeleza.com.br' } });
  if (!matheusUser) {
    matheusUser = await prisma.user.create({
      data: {
        tenantId: estiloTenant.id,
        name: 'Matheus Especialista',
        email: 'matheus@estilobeleza.com.br',
        passwordHash: defaultPasswordHash,
        role: Role.PROFESSIONAL
      }
    });
  } else {
    await prisma.user.update({
      where: { id: matheusUser.id },
      data: { name: 'Matheus Especialista', passwordHash: defaultPasswordHash }
    });
  }

  let profCarlos = await prisma.professional.findFirst({ where: { tenantId: estiloTenant.id, userId: estiloOwner.id } });
  if (!profCarlos) {
    profCarlos = await prisma.professional.create({
      data: {
        tenantId: estiloTenant.id,
        userId: estiloOwner.id,
        name: 'Carlos Dono',
        phone: '11999991111'
      }
    });
  }

  let profMatheus = await prisma.professional.findFirst({ where: { tenantId: estiloTenant.id, userId: matheusUser.id } });
  if (!profMatheus) {
    profMatheus = await prisma.professional.create({
      data: {
        tenantId: estiloTenant.id,
        userId: matheusUser.id,
        name: 'Matheus Especialista',
        phone: '11999992222'
      }
    });
  } else {
    await prisma.professional.update({
      where: { id: profMatheus.id },
      data: { name: 'Matheus Especialista' }
    });
  }

  const estiloServices = await prisma.service.findMany({ where: { tenantId: estiloTenant.id } });
  if (estiloServices.length === 0) {
    await prisma.service.createMany({
      data: [
        { tenantId: estiloTenant.id, name: 'Atendimento Individual', price: 50.00, durationMinutes: 30 },
        { tenantId: estiloTenant.id, name: 'Consultoria Especializada', price: 100.00, durationMinutes: 60 },
        { tenantId: estiloTenant.id, name: 'Sessão Completa', price: 150.00, durationMinutes: 60 }
      ]
    });
  }

  // 3. Demo Account: Clínica Saúde
  const clinicaEmail = 'contato@clinicasaude.com.br';
  let clinicaTenant = await prisma.tenant.findFirst({ where: { ownerEmail: clinicaEmail } });
  if (!clinicaTenant) {
    clinicaTenant = await prisma.tenant.create({
      data: {
        name: 'Clínica Saúde & Estética',
        slug: 'clinica-saude',
        planTier: 'MULTI_USER',
        ownerEmail: clinicaEmail,
        maxUsers: 5,
        aiConfig: {
          create: {
            systemPrompt: 'Você é a secretária virtual da Clínica Saúde & Estética. Seja formal e prestativa.',
            businessInfo: 'Clínica Saúde & Estética. Av. Paulista, 1000. Seg a Sex 08h às 18h.'
          }
        }
      }
    });
  }

  let clinicaOwner = await prisma.user.findFirst({ where: { email: clinicaEmail } });
  if (!clinicaOwner) {
    clinicaOwner = await prisma.user.create({
      data: {
        tenantId: clinicaTenant.id,
        name: 'Dra. Ana Saúde',
        email: clinicaEmail,
        passwordHash: defaultPasswordHash,
        role: Role.OWNER
      }
    });
  } else {
    await prisma.user.update({
      where: { id: clinicaOwner.id },
      data: { passwordHash: defaultPasswordHash }
    });
  }

  let profAna = await prisma.professional.findFirst({ where: { tenantId: clinicaTenant.id } });
  if (!profAna) {
    await prisma.professional.create({
      data: {
        tenantId: clinicaTenant.id,
        userId: clinicaOwner.id,
        name: 'Dra. Ana Saúde',
        phone: '11988883333'
      }
    });
  }

  const clinicaServices = await prisma.service.findMany({ where: { tenantId: clinicaTenant.id } });
  if (clinicaServices.length === 0) {
    await prisma.service.createMany({
      data: [
        { tenantId: clinicaTenant.id, name: 'Consulta Médica', price: 150.00, durationMinutes: 45 },
        { tenantId: clinicaTenant.id, name: 'Limpeza de Pele', price: 120.00, durationMinutes: 60 }
      ]
    });
  }

  console.log('✅ SEED COMPLETO COM SUCESSO! Senha padrão para todas as contas: 123456');
}

if (process.argv[1]?.includes('seed')) {
  seedDatabase().catch(console.error).finally(() => prisma.$disconnect());
}
