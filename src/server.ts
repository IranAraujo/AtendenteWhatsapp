import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateAvailableSlots } from './services/schedule.service.js';
import { buildSystemInstruction } from './services/ai.service.js';
import { aiOrchestrator, transcribeAudioBuffer } from './services/ai-orchestrator.service.js';
import { whatsappService } from './services/whatsapp.service.js';
import { adminService } from './services/admin.service.js';
import { dbRepository } from './services/db.service.js';
import { generateJwtToken, comparePassword, hashPassword } from './services/auth.service.js';
import { requireAuth } from './middleware/auth.middleware.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const helmetFn: any = (helmet as any).default || helmet;
const rateLimitFn: any = (rateLimit as any) || (rateLimit as any).default;

// Proteção de Cabeçalhos HTTP com Helmet (permitindo inline scripts para o dashboard local)
app.use(helmetFn({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Rate Limiter para Proteção contra Ataques de Força Bruta
const loginLimiter = rateLimitFn({
  windowMs: 60 * 1000, // 1 minuto
  max: 15, // Máximo 15 tentativas por minuto por IP
  message: { success: false, error: 'Muitas tentativas de login. Aguarde 1 minuto e tente novamente.' }
});

const apiLimiter = rateLimitFn({
  windowMs: 60 * 1000,
  max: 150,
  message: { success: false, error: 'Limite de requisições excedido. Aguarde alguns instantes.' }
});

app.use('/api/', apiLimiter);

// Desativar cache do navegador para garantir que o painel sempre carregue a versão mais recente
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const PORT = process.env.PORT || 3001;

// Rota Raiz (/) -> Abre diretamente a Tela de Login
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Rota do Login (/login)
app.get('/login', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Rota do Painel Dashboard (/dashboard)
app.get('/dashboard', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Servir arquivos estáticos do Painel Web Frontend (public/) sem index automático
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

// Healthcheck
app.get('/api/health', (req: Request, res: Response) => {
  const nvidiaKey = process.env.NVIDIA_API_KEY || '';
  const mem = process.memoryUsage();
  res.json({
    status: 'OK',
    app: 'SaaS Atendente & Agendamento WhatsApp IA',
    version: '1.0.0',
    port: PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
    },
    timestamp: new Date().toISOString(),
    env: {
      hasNvidiaKey: !!nvidiaKey,
      nvidiaKeyPrefix: nvidiaKey ? nvidiaKey.substring(0, 8) + '...' : 'NOT_CONFIGURED',
      hasGroqKey: !!process.env.GROQ_API_KEY,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  });
});

// Rota dedicada para o Painel Super-Admin Master
app.get('/admin', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// -------------------------------------------------------------
// API DE AUTENTICAÇÃO (LOGIN DE PROPRIETÁRIOS E PROFISSIONAIS)
// -------------------------------------------------------------

app.post('/api/auth/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios.' });
    }

    const found = await dbRepository.findUserByEmail(email);
    if (!found || !comparePassword(password, found.user.passwordHash)) {
      return res.status(401).json({ success: false, error: 'Email ou senha incorretos.' });
    }

    const token = generateJwtToken({
      userId: found.user.id,
      tenantId: found.user.tenantId,
      role: found.user.role,
      email: found.user.email
    });

    res.json({
      success: true,
      token,
      user: {
        id: found.user.id,
        tenantId: found.user.tenantId,
        name: found.user.name,
        email: found.user.email,
        role: found.user.role,
        professionalId: found.user.professionalId
      },
      tenant: {
        id: found.tenant.id,
        name: found.tenant.name,
        planTier: found.tenant.planTier,
        maxUsers: found.tenant.maxUsers
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/change-password', async (req: Request, res: Response) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }

    let foundUser: any = null;
    for (const t of (dbRepository as any)['tenants']) {
      const u = t.users.find((usr: any) => usr.id === userId);
      if (u) {
        foundUser = u;
        break;
      }
    }

    if (!foundUser || !comparePassword(currentPassword, foundUser.passwordHash)) {
      return res.status(401).json({ success: false, error: 'Senha atual incorreta.' });
    }

    const newHash = hashPassword(newPassword);
    await dbRepository.updateUserPassword(userId, newHash);
    res.json({ success: true, message: 'Senha alterada com sucesso!' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tenants/:id/upgrade-plan', async (req: Request, res: Response) => {
  try {
    const { planTier } = req.body;
    if (!planTier || !['SINGLE_USER', 'MULTI_USER', 'ENTERPRISE'].includes(planTier)) {
      return res.status(400).json({ success: false, error: 'Plano inválido.' });
    }

    const result = await dbRepository.updateTenantPlan(req.params.id, planTier as any);
    if (result.success) {
      res.json({ success: true, message: `Plano atualizado para ${planTier}!`, maxUsers: result.maxUsers, planTier });
    } else {
      res.status(404).json({ success: false, error: 'Estabelecimento não encontrado.' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/tenants/:id/billing', async (req: Request, res: Response) => {
  try {
    const { paymentMethod, creditCardMasked, pixKey } = req.body;
    const updated = await dbRepository.updateTenantBilling(req.params.id, { paymentMethod, creditCardMasked, pixKey, updatedAt: new Date().toISOString() });
    if (updated) {
      res.json({ success: true, message: 'Forma de pagamento atualizada com sucesso!' });
    } else {
      res.status(404).json({ success: false, error: 'Estabelecimento não encontrado.' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// API AGENDAMENTOS AO VIVO PARA O CALENDÁRIO WEB
// -------------------------------------------------------------

app.get('/api/appointments', async (req: Request, res: Response) => {
  try {
    let tenantId = req.query.tenantId as string;
    if (!tenantId || tenantId === 'null' || tenantId === 'undefined' || tenantId.trim() === '') {
      tenantId = 'tenant-demo-estilo';
    }
    const professionalId = req.query.professionalId as string;
    let appointments = await dbRepository.getAllAppointments(tenantId);

    if (professionalId && professionalId !== 'ALL' && professionalId !== 'undefined' && professionalId !== 'null' && professionalId.trim() !== '') {
      appointments = appointments.filter(a => a.professionalId === professionalId);
    }

    res.json({ success: true, appointments });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/appointments/:id', async (req: Request, res: Response) => {
  try {
    const { dateStr, timeStr, customerName, customerPhone, status, professionalId } = req.body;
    let updates: any = { customerName, customerPhone, status };
    if (professionalId) updates.professionalId = professionalId;

    if (dateStr && timeStr) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hours, minutes] = timeStr.split(':').map(Number);
      const pad = (n: number) => String(n).padStart(2, '0');
      const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
      const startTime = new Date(localIso);
      const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
      updates.startTime = startTime;
      updates.endTime = endTime;
    }

    const updated = await dbRepository.updateAppointmentDetails(req.params.id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Agendamento não encontrado' });
    }
    res.json({ success: true, appointment: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/appointments/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await dbRepository.deleteAppointment(req.params.id);
    res.json({ success: deleted });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// API WHATSAPP REAL (BAILEYS ENGINE VIA QR CODE VIVO)
// -------------------------------------------------------------

app.get('/api/whatsapp/qr', async (req: Request, res: Response) => {
  try {
    const tenantId = (req.query.tenantId as string) || 'tenant-demo-estilo';
    const state = whatsappService.getSessionState(tenantId);
    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/whatsapp/connect', async (req: Request, res: Response) => {
  try {
    const { tenantId = 'tenant-demo-estilo', forceClean = true } = req.body;
    const session = await whatsappService.startSession(tenantId, forceClean);
    res.json({ success: true, session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/whatsapp/disconnect', async (req: Request, res: Response) => {
  try {
    const { tenantId = 'tenant-demo-estilo' } = req.body;
    const disconnected = await whatsappService.logoutSession(tenantId);
    res.json({ success: disconnected });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// API MULTI-TENANT CONTEXT & DETALHES
// -------------------------------------------------------------

app.get('/api/tenants/:id', async (req: Request, res: Response) => {
  try {
    const tenant = await dbRepository.getTenantById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Estabelecimento não encontrado' });
    }
    const services = await dbRepository.listServices(req.params.id);
    const products = await dbRepository.listProducts(req.params.id);
    const professionals = await dbRepository.listProfessionals(req.params.id);
    res.json({ success: true, tenant, services, products, professionals });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/tenants/:id/ai', async (req: Request, res: Response) => {
  try {
    const { systemPrompt, businessInfo } = req.body;
    const tenant = await dbRepository.getTenantById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Estabelecimento não encontrado' });
    }

    tenant.aiConfig.systemPrompt = systemPrompt || tenant.aiConfig.systemPrompt;
    tenant.aiConfig.businessInfo = businessInfo || tenant.aiConfig.businessInfo;

    const updated = await dbRepository.saveTenant(tenant);
    res.json({ success: true, tenant: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// GESTÃO DE EQUIPE, PROFISSIONAIS & HORÁRIOS DA JORNADA DE TRABALHO
// -------------------------------------------------------------

app.post('/api/tenants/:id/whatsapp/send-direct', async (req: Request, res: Response) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: 'Telefone e mensagem são obrigatórios.' });
    }

    const sent = await whatsappService.sendMessage(req.params.id, phone, message);
    if (sent) {
      res.json({ success: true, message: 'Mensagem enviada com sucesso ao WhatsApp do cliente!' });
    } else {
      res.status(400).json({ success: false, error: 'Falha ao enviar mensagem. Verifique se o WhatsApp está conectado.' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tenants/:id/users', async (req: Request, res: Response) => {
  try {
    const tenant = await dbRepository.getTenantById(req.params.id);
    if (!tenant) return res.status(404).json({ success: false, error: 'Estabelecimento não encontrado' });
    const professionals = await dbRepository.listProfessionals(req.params.id);
    res.json({ success: true, users: tenant.users || [], professionals, maxUsers: tenant.maxUsers, planTier: tenant.planTier });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tenants/:id/users', async (req: Request, res: Response) => {
  try {
    const { name, email, password = '123456', role = 'PROFESSIONAL' } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Nome e email são obrigatórios.' });
    }

    const result = await dbRepository.addUserToTenant(req.params.id, { name, email, passwordHash: password, role });
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    res.json({ success: true, user: result.user });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/tenants/:id/users/:userId', async (req: Request, res: Response) => {
  try {
    const { name, email, role, password } = req.body;
    const result = await dbRepository.updateUserInTenant(req.params.id, req.params.userId, {
      name,
      email,
      role,
      password
    });
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }
    res.json({ success: true, user: result.user });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/tenants/:id/users/:userId', async (req: Request, res: Response) => {
  try {
    const deleted = await dbRepository.deleteUserFromTenant(req.params.id, req.params.userId);
    res.json({ success: deleted });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tenants/:id/professionals', async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.query;
    const professionals = await dbRepository.listProfessionals(req.params.id, serviceId as string);
    res.json({ success: true, professionals });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/tenants/:id/professionals/:profId', async (req: Request, res: Response) => {
  try {
    const { servicesHandled, workSchedule } = req.body;
    const updated = await dbRepository.updateProfessional(req.params.id, req.params.profId, {
      servicesHandled,
      workSchedule
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Profissional não encontrado' });
    }
    res.json({ success: true, professional: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// CRUD DE SERVIÇOS DO TENANT
// -------------------------------------------------------------

app.get('/api/tenants/:id/services', async (req: Request, res: Response) => {
  try {
    const services = await dbRepository.listServices(req.params.id);
    res.json({ success: true, services });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tenants/:id/services', async (req: Request, res: Response) => {
  try {
    const { name, price, durationMinutes, description } = req.body;
    if (!name || price === undefined || !durationMinutes) {
      return res.status(400).json({ success: false, error: 'Campos name, price e durationMinutes são obrigatórios.' });
    }
    const service = await dbRepository.addService(req.params.id, {
      name,
      price: Number(price),
      durationMinutes: Number(durationMinutes),
      description: description || ''
    });
    res.json({ success: true, service });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/tenants/:id/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const updated = await dbRepository.updateService(req.params.id, req.params.serviceId, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Serviço não encontrado' });
    }
    res.json({ success: true, service: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/tenants/:id/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const deleted = await dbRepository.deleteService(req.params.id, req.params.serviceId);
    res.json({ success: deleted });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// CRUD DE PRODUTOS DO TENANT
// -------------------------------------------------------------

app.get('/api/tenants/:id/products', async (req: Request, res: Response) => {
  try {
    const products = await dbRepository.listProducts(req.params.id);
    res.json({ success: true, products });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tenants/:id/products', async (req: Request, res: Response) => {
  try {
    const { name, price, stock = 10, description } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, error: 'Campos name e price são obrigatórios.' });
    }
    const product = await dbRepository.addProduct(req.params.id, {
      name,
      price: Number(price),
      stock: Number(stock),
      description: description || ''
    });
    res.json({ success: true, product });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/tenants/:id/products/:productId', async (req: Request, res: Response) => {
  try {
    const updated = await dbRepository.updateProduct(req.params.id, req.params.productId, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado' });
    }
    res.json({ success: true, product: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/tenants/:id/products/:productId', async (req: Request, res: Response) => {
  try {
    const deleted = await dbRepository.deleteProduct(req.params.id, req.params.productId);
    res.json({ success: deleted });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// API SUPER-ADMIN SAAS: GESTÃO DE CLIENTES & PLANOS
// -------------------------------------------------------------

app.get('/api/admin/tenants', async (req: Request, res: Response) => {
  try {
    const tenants = await adminService.getAllTenants();
    res.json({ success: true, tenants });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/tenants', async (req: Request, res: Response) => {
  try {
    const { name, ownerEmail, planTier = 'SINGLE_USER', maxUsers } = req.body;
    if (!name || !ownerEmail) {
      return res.status(400).json({ success: false, error: 'name e ownerEmail são obrigatórios' });
    }

    const tenant = await adminService.createTenant({ name, ownerEmail, planTier, maxUsers });
    res.json({ success: true, tenant });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/tenants/:id', async (req: Request, res: Response) => {
  try {
    const updated = await adminService.updateTenant(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Tenant não encontrado' });
    }
    res.json({ success: true, tenant: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/tenants/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await adminService.deleteTenant(req.params.id);
    res.json({ success: deleted });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// CHAT SIMULATOR & AGENDAMENTOS
// -------------------------------------------------------------

app.post('/api/chat/simulate', async (req: Request, res: Response) => {
  try {
    const { tenantId = 'tenant-demo-estilo', customerPhone = '5511999998888', message, systemPrompt, businessInfo, pushName } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Campo "message" é obrigatório.' });
    }

    const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, message, { systemPrompt, businessInfo, pushName });

    res.json({
      success: true,
      tenantId,
      customerPhone,
      message,
      replyText: aiResult.replyText,
      functionCallsExecuted: aiResult.functionCallsExecuted,
      appointmentCreated: aiResult.appointmentCreated || null,
      appointmentCancelledId: aiResult.appointmentCancelledId || null,
      engine: aiResult.engine || 'LOCAL_FALLBACK',
      errorReason: aiResult.errorReason || null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/simulate-audio', async (req: Request, res: Response) => {
  try {
    const { tenantId = 'tenant-demo-estilo', customerPhone = '5511999998888', audioBase64, mimeType = 'audio/webm', systemPrompt, businessInfo, pushName } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'Campo "audioBase64" é obrigatório.' });
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const transcribedText = await transcribeAudioBuffer(audioBuffer, mimeType);

    const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, transcribedText, { systemPrompt, businessInfo, pushName });

    res.json({
      success: true,
      tenantId,
      customerPhone,
      transcribedText,
      replyText: aiResult.replyText,
      functionCallsExecuted: aiResult.functionCallsExecuted,
      appointmentCreated: aiResult.appointmentCreated || null,
      appointmentCancelledId: aiResult.appointmentCancelledId || null,
      engine: aiResult.engine || 'LOCAL_FALLBACK',
      errorReason: aiResult.errorReason || null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/schedule/slots', (req: Request, res: Response) => {
  try {
    const { dateStr, serviceDurationMinutes, schedule, isExceptionUnavailable, existingAppointments } = req.body;

    if (!dateStr || !serviceDurationMinutes) {
      return res.status(400).json({ error: 'dateStr e serviceDurationMinutes são obrigatórios.' });
    }

    const availableSlots = calculateAvailableSlots({
      dateStr,
      serviceDurationMinutes: Number(serviceDurationMinutes),
      schedule: schedule || { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' },
      isExceptionUnavailable: Boolean(isExceptionUnavailable),
      existingAppointments: (existingAppointments || []).map((appt: any) => ({
        startTime: new Date(appt.startTime),
        endTime: new Date(appt.endTime)
      })),
      slotIntervalMinutes: 30
    });

    return res.json({
      dateStr,
      availableSlotsCount: availableSlots.length,
      availableSlots
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

import { reminderService } from './services/reminder.service.js';

app.put('/api/tenants/:id/reminders', async (req: Request, res: Response) => {
  try {
    const { enable24hReminder, custom24hText, enable1hReminder, custom1hText } = req.body;
    const success = await dbRepository.updateTenantReminders(req.params.id, {
      enable24hReminder: Boolean(enable24hReminder),
      custom24hText,
      enable1hReminder: Boolean(enable1hReminder),
      custom1hText
    });
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tenants/:id/reminders/test', async (req: Request, res: Response) => {
  try {
    const { phone, type = '1h', delaySeconds = 10 } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Telefone é obrigatório para envio do teste.' });
    }

    const tenant = await dbRepository.getTenantById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant não encontrado.' });
    }

    const sessionState = whatsappService.getSessionState(req.params.id);
    if (sessionState.status !== 'CONNECTED') {
      return res.status(400).json({ 
        success: false, 
        error: 'O WhatsApp deste estabelecimento está DESCONECTADO no momento. Vá na aba "Conectar WhatsApp" e escaneie o QR Code primeiro!' 
      });
    }

    const config = tenant.remindersConfig || {
      custom24hText: 'Olá {nome}! Passando para lembrar do seu agendamento amanhã ({data}) às {horario} com {profissional}. \n\nResponda *1* para *CONFIRMAR* ou *2* para *CANCELAR*.',
      custom1hText: 'Olá {nome}! Seu atendimento é daqui a 1 hora às {horario} com {profissional}. \n\nResponda *1* para *CONFIRMAR* ou *2* para *CANCELAR*.'
    };

    const template = type === '24h' 
      ? (config.custom24hText || 'Olá {nome}! Passando para lembrar do seu agendamento amanhã ({data}) às {horario} com {profissional}. \n\nResponda *1* para *CONFIRMAR* ou *2* para *CANCELAR*.')
      : (config.custom1hText || 'Olá {nome}! Seu atendimento é daqui a 1 hora às {horario} com {profissional}. \n\nResponda *1* para *CONFIRMAR* ou *2* para *CANCELAR*.');

    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const text = template
      .replace(/\{nome\}/gi, 'Cliente (Teste)')
      .replace(/\{horario\}/gi, timeStr)
      .replace(/\{data\}/gi, dateStr)
      .replace(/\{profissional\}/gi, 'Lucas Silva')
      .replace(/\{servico\}/gi, 'Atendimento Estético');

    const delayMs = (Number(delaySeconds) || 10) * 1000;

    res.json({ 
      success: true, 
      message: `⏰ Teste de lembrete (${type}) agendado! Aguarde ${Number(delaySeconds) || 10} segundos para receber no seu WhatsApp (${phone}).` 
    });

    setTimeout(async () => {
      try {
        const sent = await whatsappService.sendMessage(req.params.id, phone, text);
        if (sent) {
          console.log(`[Reminder Test] Lembrete de ${delaySeconds}s entregue com sucesso para ${phone}`);
        } else {
          console.warn(`[Reminder Test] Falha ao entregar lembrete para ${phone}`);
        }
      } catch (err: any) {
        console.error('[Reminder Test Async Error]:', err.message);
      }
    }, delayMs);

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rota de fallback para servir o Painel Web Assinante SPA
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(` Servidor SaaS Backend & WhatsApp Real Baileys rodando em http://localhost:${PORT}`);
    reminderService.startScheduler();
    whatsappService.autoReconnectSavedSessions().catch(err => {
      console.warn('[WhatsApp AutoReconnect Warning]:', err.message);
    });
  });

  const handleGracefulShutdown = async (signal: string) => {
    console.log(`\n[Server] Recebido sinal ${signal}. Encerrando conexões com segurança...`);
    try {
      server.close();
      console.log('[Server] Servidor HTTP finalizado com sucesso.');
    } catch (e) {}
    process.exit(0);
  };

  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
}

export default app;
