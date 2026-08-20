import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateAvailableSlots, selectRoundRobinProfessional } from './services/schedule.service.js';
import { aiOrchestrator, transcribeAudioBuffer } from './services/ai-orchestrator.service.js';
import { whatsappService } from './services/whatsapp.service.js';
import { adminService } from './services/admin.service.js';
import { dbRepository } from './services/db.service.js';
import { generateJwtToken, comparePassword, hashPassword } from './services/auth.service.js';
import { AVAILABLE_VOICES, generateSpeechAudio } from './services/tts.service.js';
import { webhookService } from './services/webhook.service.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const helmetFn = helmet.default || helmet;
const rateLimitFn = rateLimit || rateLimit.default;
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
// Rota Principal (/) -> Frente de Loja / Landing Page Institucional
app.get(['/', '/home', '/landing'], (req, res) => {
    res.sendFile(path.join(__dirname, '../public/landing.html'));
});
// Rota do Login (/login)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});
// Rota do Painel Dashboard (/dashboard, /app)
app.get(['/dashboard', '/app'], (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});
// Servir arquivos estáticos do Painel Web Frontend (public/) sem index automático
app.use(express.static(path.join(__dirname, '../public'), { index: false }));
// Healthcheck
app.get('/api/health', (req, res) => {
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
// Rotas públicas do Frontend
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});
app.get(['/register', '/cadastro', '/planos', '/assinar'], (req, res) => {
    res.sendFile(path.join(__dirname, '../public/register.html'));
});
// -------------------------------------------------------------
// METADADOS DE PLANOS SAAS
// -------------------------------------------------------------
app.get('/api/plans', (req, res) => {
    res.json({
        success: true,
        plans: [
            {
                id: 'FREE',
                name: 'Plano Grátis',
                tagline: 'Ideal para conhecer e começar sem nenhum custo',
                monthlyPrice: 0,
                annualPriceMonthly: 0,
                maxUsers: 1,
                maxProfessionals: 1,
                badge: '100% Gratuito',
                popular: false,
                features: [
                    '1 Profissional / 1 Usuário',
                    'Atendente IA no WhatsApp',
                    'Limite de até 10 agendamentos por dia',
                    'Catálogo de serviços e produtos',
                    'Agenda online pública',
                    'Acesso vitalício sem mensalidade'
                ]
            },
            {
                id: 'SINGLE_USER',
                name: 'Starter Individual',
                tagline: 'Ideal para autônomos e profissionais independentes',
                monthlyPrice: 97,
                annualPriceMonthly: 77, // R$ 924/ano
                maxUsers: 1,
                maxProfessionals: 1,
                badge: 'Início Rápido',
                popular: false,
                features: [
                    '1 Profissional / 1 Usuário',
                    'Atendente IA 24/7 no WhatsApp',
                    'Agendamentos Ilimitados',
                    'Lembretes automáticos (24h e 1h antes)',
                    'Catálogo de serviços e produtos',
                    'Painel de gestão e agenda online',
                    'Suporte via WhatsApp'
                ]
            },
            {
                id: 'MULTI_USER',
                name: 'Pro Negócios',
                tagline: 'Perfeito para salões, barbearias e clínicas em crescimento',
                monthlyPrice: 197,
                annualPriceMonthly: 157, // R$ 1.884/ano
                maxUsers: 5,
                maxProfessionals: 5,
                badge: 'Mais Popular',
                popular: true,
                features: [
                    'Até 5 Profissionais com agendas independentes',
                    'Atendente IA com Respostas Naturais e Áudio Whisper',
                    'Envio de Resposta por Voz Ultra-Realista (TTS)',
                    'Lista de Espera Inteligente com aviso automático',
                    'Bloqueio de Folgas e Intervalos',
                    'Painel de Métricas Financeiras e Faturamento',
                    'Controle de Acesso por Permissões',
                    'Suporte Prioritário'
                ]
            }
        ]
    });
});
// -------------------------------------------------------------
// API DE AUTENTICAÇÃO (CADASTRO E LOGIN)
// -------------------------------------------------------------
app.post('/api/auth/register', loginLimiter, async (req, res) => {
    try {
        const { ownerName, email, password, companyName, phone, planTier, segment, businessAddress } = req.body;
        if (!ownerName || !email || !password || !companyName) {
            return res.status(400).json({
                success: false,
                error: 'Campos obrigatórios: Nome do Responsável, Email, Senha e Nome do Estabelecimento.'
            });
        }
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'A senha deve conter no mínimo 6 caracteres.'
            });
        }
        const { tenant, user, initialServices, initialProfessional } = await dbRepository.registerTenantAndOwner({
            ownerName,
            email,
            password,
            companyName,
            phone,
            planTier: planTier || 'MULTI_USER',
            segment: segment || 'barbearia',
            businessAddress
        });
        const token = generateJwtToken({
            userId: user.id,
            tenantId: user.tenantId,
            role: user.role,
            email: user.email
        });
        res.status(201).json({
            success: true,
            message: 'Conta e estabelecimento criados com sucesso!',
            token,
            user: {
                id: user.id,
                tenantId: user.tenantId,
                name: user.name,
                email: user.email,
                role: user.role,
                professionalId: user.professionalId
            },
            tenant: {
                id: tenant.id,
                name: tenant.name,
                slug: tenant.slug,
                planTier: tenant.planTier,
                maxUsers: tenant.maxUsers
            },
            initialServicesCount: initialServices.length,
            initialProfessionalName: initialProfessional.name
        });
    }
    catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});
app.post('/api/auth/login', loginLimiter, async (req, res) => {
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
                slug: found.tenant.slug,
                planTier: found.tenant.planTier,
                maxUsers: found.tenant.maxUsers
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/auth/change-password', async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body;
        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });
        }
        // BUG 3 FIX: usar método público findUserById em vez de acesso a propriedade privada via (dbRepository as any)
        const found = await dbRepository.findUserById(userId);
        if (!found || !comparePassword(currentPassword, found.user.passwordHash)) {
            return res.status(401).json({ success: false, error: 'Senha atual incorreta.' });
        }
        const newHash = hashPassword(newPassword);
        await dbRepository.updateUserPassword(userId, newHash);
        res.json({ success: true, message: 'Senha alterada com sucesso!' });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/tenants/:id/upgrade-plan', async (req, res) => {
    try {
        const { planTier } = req.body;
        if (!planTier || !['FREE', 'SINGLE_USER', 'MULTI_USER'].includes(planTier)) {
            return res.status(400).json({ success: false, error: 'Plano inválido.' });
        }
        const result = await dbRepository.updateTenantPlan(req.params.id, planTier);
        if (result.success) {
            res.json({ success: true, message: `Plano atualizado para ${planTier}!`, maxUsers: result.maxUsers, planTier });
        }
        else {
            res.status(404).json({ success: false, error: 'Estabelecimento não encontrado.' });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/tenants/:id/billing', async (req, res) => {
    try {
        const { paymentMethod, creditCardMasked, pixKey } = req.body;
        const updated = await dbRepository.updateTenantBilling(req.params.id, { paymentMethod, creditCardMasked, pixKey, updatedAt: new Date().toISOString() });
        if (updated) {
            res.json({ success: true, message: 'Forma de pagamento atualizada com sucesso!' });
        }
        else {
            res.status(404).json({ success: false, error: 'Estabelecimento não encontrado.' });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// API AGENDAMENTOS AO VIVO PARA O CALENDÁRIO WEB
// -------------------------------------------------------------
app.get('/api/appointments', async (req, res) => {
    try {
        let tenantId = req.query.tenantId;
        if (!tenantId || tenantId === 'null' || tenantId === 'undefined' || tenantId.trim() === '') {
            tenantId = 'tenant-demo-estilo';
        }
        const professionalId = req.query.professionalId;
        let appointments = await dbRepository.getAllAppointments(tenantId);
        if (professionalId && professionalId !== 'ALL' && professionalId !== 'undefined' && professionalId !== 'null' && professionalId.trim() !== '') {
            appointments = appointments.filter(a => a.professionalId === professionalId);
        }
        const formattedAppts = appointments.map(a => {
            const st = (a.startTime instanceof Date) ? a.startTime : new Date(a.startTime);
            const et = (a.endTime instanceof Date) ? a.endTime : new Date(a.endTime || st.getTime() + 45 * 60000);
            let dateStr = '';
            let timeStr = '';
            try {
                const parts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'America/Sao_Paulo',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).formatToParts(st);
                const y = parts.find(p => p.type === 'year')?.value;
                const m = parts.find(p => p.type === 'month')?.value;
                const d = parts.find(p => p.type === 'day')?.value;
                const h = parts.find(p => p.type === 'hour')?.value;
                const min = parts.find(p => p.type === 'minute')?.value;
                dateStr = `${y}-${m}-${d}`;
                timeStr = `${h}:${min}`;
            }
            catch {
                const y = st.getFullYear();
                const m = String(st.getMonth() + 1).padStart(2, '0');
                const d = String(st.getDate()).padStart(2, '0');
                dateStr = `${y}-${m}-${d}`;
                timeStr = `${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}`;
            }
            return {
                ...a,
                dateStr,
                timeStr,
                startTime: st.toISOString(),
                endTime: et.toISOString()
            };
        });
        res.json({ success: true, appointments: formattedAppts });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/appointments/:id', async (req, res) => {
    try {
        const { dateStr, timeStr, customerName, customerPhone, status, professionalId } = req.body;
        let updates = { customerName, customerPhone, status };
        if (professionalId)
            updates.professionalId = professionalId;
        if (dateStr && timeStr) {
            const [year, month, day] = dateStr.split('-').map(Number);
            const [hours, minutes] = timeStr.split(':').map(Number);
            const pad = (n) => String(n).padStart(2, '0');
            const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00-03:00`;
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
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.delete('/api/appointments/:id', async (req, res) => {
    try {
        const deleted = await dbRepository.deleteAppointment(req.params.id);
        res.json({ success: deleted });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// API WHATSAPP REAL (BAILEYS ENGINE VIA QR CODE VIVO)
// -------------------------------------------------------------
app.get('/api/whatsapp/qr', async (req, res) => {
    try {
        const tenantId = req.query.tenantId || 'tenant-demo-estilo';
        const state = whatsappService.getSessionState(tenantId);
        res.json(state);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/whatsapp/connect', async (req, res) => {
    try {
        const { tenantId = 'tenant-demo-estilo', forceClean = true } = req.body;
        const session = await whatsappService.startSession(tenantId, forceClean);
        res.json({ success: true, session });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
        const { tenantId = 'tenant-demo-estilo' } = req.body;
        const disconnected = await whatsappService.logoutSession(tenantId);
        res.json({ success: disconnected });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// API MULTI-TENANT CONTEXT & DETALHES
// -------------------------------------------------------------
app.get('/api/tenants/:id', async (req, res) => {
    try {
        const tenant = await dbRepository.getTenantById(req.params.id);
        if (!tenant) {
            return res.status(404).json({ success: false, error: 'Estabelecimento não encontrado' });
        }
        const services = await dbRepository.listServices(req.params.id);
        const products = await dbRepository.listProducts(req.params.id);
        const professionals = await dbRepository.listProfessionals(req.params.id);
        res.json({ success: true, tenant, services, products, professionals });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/tenants/:id/ai', async (req, res) => {
    try {
        const { systemPrompt, businessInfo, faqItems, voiceId, voiceReplyMode } = req.body;
        const tenant = await dbRepository.getTenantById(req.params.id);
        if (!tenant) {
            return res.status(404).json({ success: false, error: 'Estabelecimento não encontrado' });
        }
        if (systemPrompt !== undefined)
            tenant.aiConfig.systemPrompt = systemPrompt;
        if (businessInfo !== undefined)
            tenant.aiConfig.businessInfo = businessInfo;
        if (faqItems !== undefined)
            tenant.aiConfig.faqItems = faqItems;
        if (voiceId !== undefined)
            tenant.aiConfig.voiceId = voiceId;
        if (voiceReplyMode !== undefined)
            tenant.aiConfig.voiceReplyMode = voiceReplyMode;
        const updated = await dbRepository.saveTenant(tenant);
        res.json({ success: true, tenant: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// GESTÃO DE EQUIPE, PROFISSIONAIS & HORÁRIOS DA JORNADA DE TRABALHO
// -------------------------------------------------------------
app.post('/api/tenants/:id/whatsapp/send-direct', async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Telefone e mensagem são obrigatórios.' });
        }
        const sent = await whatsappService.sendMessage(req.params.id, phone, message);
        if (sent) {
            res.json({ success: true, message: 'Mensagem enviada com sucesso ao WhatsApp do cliente!' });
        }
        else {
            res.status(400).json({ success: false, error: 'Falha ao enviar mensagem. Verifique se o WhatsApp está conectado.' });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.get('/api/tenants/:id/users', async (req, res) => {
    try {
        const tenant = await dbRepository.getTenantById(req.params.id);
        if (!tenant)
            return res.status(404).json({ success: false, error: 'Estabelecimento não encontrado' });
        const professionals = await dbRepository.listProfessionals(req.params.id);
        res.json({ success: true, users: tenant.users || [], professionals, maxUsers: tenant.maxUsers, planTier: tenant.planTier });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/tenants/:id/users', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/tenants/:id/users/:userId', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.delete('/api/tenants/:id/users/:userId', async (req, res) => {
    try {
        const deleted = await dbRepository.deleteUserFromTenant(req.params.id, req.params.userId);
        res.json({ success: deleted });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.get('/api/tenants/:id/professionals', async (req, res) => {
    try {
        const { serviceId } = req.query;
        const professionals = await dbRepository.listProfessionals(req.params.id, serviceId);
        res.json({ success: true, professionals });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/tenants/:id/professionals/:profId', async (req, res) => {
    try {
        const { servicesHandled, workSchedule, phone, maxAppointmentsPerDay } = req.body;
        const updated = await dbRepository.updateProfessional(req.params.id, req.params.profId, {
            ...(servicesHandled !== undefined && { servicesHandled }),
            ...(workSchedule !== undefined && { workSchedule }),
            ...(phone !== undefined && { phone }),
            ...(maxAppointmentsPerDay !== undefined && { maxAppointmentsPerDay: maxAppointmentsPerDay ? Number(maxAppointmentsPerDay) : undefined })
        });
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Profissional não encontrado' });
        }
        res.json({ success: true, professional: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// BLOQUEIOS DE AGENDA (FOLGAS, FERIADOS, BLOQUEIOS PARCIAIS)
// -------------------------------------------------------------
app.get('/api/tenants/:id/blocks', async (req, res) => {
    try {
        const { professionalId, dateStr } = req.query;
        const blocks = await dbRepository.getScheduleBlocks(req.params.id, professionalId, dateStr);
        res.json({ success: true, blocks });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/tenants/:id/blocks', async (req, res) => {
    try {
        const { professionalId, dateStr, startTime, endTime, reason } = req.body;
        if (!professionalId || !dateStr) {
            return res.status(400).json({ success: false, error: 'professionalId e dateStr são obrigatórios.' });
        }
        const block = await dbRepository.addScheduleBlock({
            tenantId: req.params.id,
            professionalId,
            dateStr,
            startTime: startTime || undefined,
            endTime: endTime || undefined,
            reason: reason || 'Bloqueio'
        });
        res.json({ success: true, block });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.delete('/api/tenants/:id/blocks/:blockId', async (req, res) => {
    try {
        const success = await dbRepository.removeScheduleBlock(req.params.blockId);
        res.json({ success });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// LISTA DE ESPERA
// -------------------------------------------------------------
app.get('/api/tenants/:id/waitlist', async (req, res) => {
    try {
        const waitlist = await dbRepository.getAllWaitlist(req.params.id);
        res.json({ success: true, waitlist });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.delete('/api/tenants/:id/waitlist/:waitlistId', async (req, res) => {
    try {
        const success = await dbRepository.removeFromWaitlist(req.params.waitlistId);
        res.json({ success });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// CRUD DE SERVIÇOS DO TENANT
// -------------------------------------------------------------
app.get('/api/tenants/:id/services', async (req, res) => {
    try {
        const services = await dbRepository.listServices(req.params.id);
        res.json({ success: true, services });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/tenants/:id/services', async (req, res) => {
    try {
        const { name, price, durationMinutes = 30, description } = req.body;
        if (!name || price === undefined || price === null || String(name).trim() === '') {
            return res.status(400).json({ success: false, error: 'Campos nome e preço são obrigatórios.' });
        }
        const cleanPrice = typeof price === 'string' ? parseFloat(price.replace(',', '.')) : Number(price);
        const cleanDuration = Number(durationMinutes) || 30;
        const service = await dbRepository.addService(req.params.id, {
            name: String(name).trim(),
            price: isNaN(cleanPrice) ? 0 : cleanPrice,
            durationMinutes: cleanDuration,
            description: description || ''
        });
        res.json({ success: true, service });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/tenants/:id/services/:serviceId', async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.price !== undefined) {
            const cleanPrice = typeof updates.price === 'string' ? parseFloat(updates.price.replace(',', '.')) : Number(updates.price);
            updates.price = isNaN(cleanPrice) ? 0 : cleanPrice;
        }
        if (updates.durationMinutes !== undefined) {
            updates.durationMinutes = Number(updates.durationMinutes) || 30;
        }
        const updated = await dbRepository.updateService(req.params.id, req.params.serviceId, updates);
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Serviço não encontrado' });
        }
        res.json({ success: true, service: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.delete('/api/tenants/:id/services/:serviceId', async (req, res) => {
    try {
        const deleted = await dbRepository.deleteService(req.params.id, req.params.serviceId);
        res.json({ success: deleted });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// CRUD DE PRODUTOS DO TENANT
// -------------------------------------------------------------
app.get('/api/tenants/:id/products', async (req, res) => {
    try {
        const products = await dbRepository.listProducts(req.params.id);
        res.json({ success: true, products });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/tenants/:id/products', async (req, res) => {
    try {
        const { name, price, stock = 10, description } = req.body;
        if (!name || price === undefined || price === null || String(name).trim() === '') {
            return res.status(400).json({ success: false, error: 'Campos nome e preço são obrigatórios.' });
        }
        const cleanPrice = typeof price === 'string' ? parseFloat(price.replace(',', '.')) : Number(price);
        const cleanStock = Number(stock) || 10;
        const product = await dbRepository.addProduct(req.params.id, {
            name: String(name).trim(),
            price: isNaN(cleanPrice) ? 0 : cleanPrice,
            stock: cleanStock,
            description: description || ''
        });
        res.json({ success: true, product });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/tenants/:id/products/:productId', async (req, res) => {
    try {
        const updated = await dbRepository.updateProduct(req.params.id, req.params.productId, req.body);
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }
        res.json({ success: true, product: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.delete('/api/tenants/:id/products/:productId', async (req, res) => {
    try {
        const deleted = await dbRepository.deleteProduct(req.params.id, req.params.productId);
        res.json({ success: deleted });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// API SUPER-ADMIN SAAS: GESTÃO DE CLIENTES & PLANOS
// -------------------------------------------------------------
app.get('/api/admin/tenants', async (req, res) => {
    try {
        const tenants = await adminService.getAllTenants();
        res.json({ success: true, tenants });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/admin/tenants', async (req, res) => {
    try {
        const { name, ownerEmail, planTier = 'SINGLE_USER', maxUsers } = req.body;
        if (!name || !ownerEmail) {
            return res.status(400).json({ success: false, error: 'name e ownerEmail são obrigatórios' });
        }
        const tenant = await adminService.createTenant({ name, ownerEmail, planTier, maxUsers });
        res.json({ success: true, tenant });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.put('/api/admin/tenants/:id', async (req, res) => {
    try {
        const updated = await adminService.updateTenant(req.params.id, req.body);
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Tenant não encontrado' });
        }
        res.json({ success: true, tenant: updated });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.delete('/api/admin/tenants/:id', async (req, res) => {
    try {
        const deleted = await adminService.deleteTenant(req.params.id);
        res.json({ success: deleted });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// CHAT SIMULATOR & AGENDAMENTOS
// -------------------------------------------------------------
app.post('/api/chat/simulate', async (req, res) => {
    try {
        const { tenantId = 'tenant-demo-estilo', customerPhone = '5511999998888', message, systemPrompt, businessInfo, pushName, isVoiceInput, voiceId } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Campo "message" é obrigatório.' });
        }
        const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, message, { systemPrompt, businessInfo, pushName });
        let audioReplyBase64 = null;
        const tenant = await dbRepository.getTenantById(tenantId);
        const voiceMode = tenant?.aiConfig?.voiceReplyMode || 'WHEN_AUDIO_RECEIVED';
        const shouldGenerateVoice = voiceMode === 'ALWAYS' || (voiceMode === 'WHEN_AUDIO_RECEIVED' && isVoiceInput);
        if (aiResult.replyText && shouldGenerateVoice) {
            try {
                const selectedVoice = voiceId || tenant?.aiConfig?.voiceId || 'pt-BR-FranciscaNeural';
                const replyAudioBuffer = await generateSpeechAudio(aiResult.replyText, selectedVoice);
                audioReplyBase64 = replyAudioBuffer.toString('base64');
            }
            catch (e) {
                console.warn('[Simulator Voice Output Error]:', e.message);
            }
        }
        res.json({
            success: true,
            tenantId,
            customerPhone,
            message,
            replyText: aiResult.replyText,
            audioReplyBase64,
            functionCallsExecuted: aiResult.functionCallsExecuted,
            appointmentCreated: aiResult.appointmentCreated || null,
            appointmentCancelledId: aiResult.appointmentCancelledId || null,
            engine: aiResult.engine || 'LOCAL_FALLBACK',
            errorReason: aiResult.errorReason || null
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/chat/simulate-audio', async (req, res) => {
    try {
        const { tenantId = 'tenant-demo-estilo', customerPhone = '5511999998888', audioBase64, mimeType = 'audio/webm', systemPrompt, businessInfo, pushName, voiceId } = req.body;
        if (!audioBase64) {
            return res.status(400).json({ error: 'Campo "audioBase64" é obrigatório.' });
        }
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const transcribedText = await transcribeAudioBuffer(audioBuffer, mimeType);
        const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, transcribedText, { systemPrompt, businessInfo, pushName });
        let audioReplyBase64 = null;
        if (aiResult.replyText) {
            try {
                const tenant = await dbRepository.getTenantById(tenantId);
                const selectedVoice = voiceId || tenant?.aiConfig?.voiceId || 'pt-BR-FranciscaNeural';
                const replyAudioBuffer = await generateSpeechAudio(aiResult.replyText, selectedVoice);
                audioReplyBase64 = replyAudioBuffer.toString('base64');
            }
            catch (e) {
                console.warn('[Simulator Audio Output Error]:', e.message);
            }
        }
        res.json({
            success: true,
            tenantId,
            customerPhone,
            transcribedText,
            replyText: aiResult.replyText,
            audioReplyBase64,
            functionCallsExecuted: aiResult.functionCallsExecuted,
            appointmentCreated: aiResult.appointmentCreated || null,
            appointmentCancelledId: aiResult.appointmentCancelledId || null,
            engine: aiResult.engine || 'LOCAL_FALLBACK',
            errorReason: aiResult.errorReason || null
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// -------------------------------------------------------------
// ENDPOINTS DE VOZ E SÍNTESE TTS
// -------------------------------------------------------------
app.get('/api/voices', (req, res) => {
    res.json({ success: true, voices: AVAILABLE_VOICES });
});
app.post('/api/tts/synthesize', async (req, res) => {
    try {
        const { text, voiceId } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, error: 'Texto é obrigatório.' });
        }
        const audioBuffer = await generateSpeechAudio(text, voiceId || 'pt-BR-FranciscaNeural');
        res.setHeader('Content-Type', 'audio/mp3');
        res.setHeader('Content-Length', audioBuffer.length);
        res.send(audioBuffer);
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/schedule/slots', (req, res) => {
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
            existingAppointments: (existingAppointments || []).map((appt) => ({
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
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
import { reminderService } from './services/reminder.service.js';
app.put('/api/tenants/:id/reminders', async (req, res) => {
    try {
        const { enable24hReminder, custom24hText, enable1hReminder, custom1hText } = req.body;
        const success = await dbRepository.updateTenantReminders(req.params.id, {
            enable24hReminder: Boolean(enable24hReminder),
            custom24hText,
            enable1hReminder: Boolean(enable1hReminder),
            custom1hText
        });
        res.json({ success });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/tenants/:id/reminders/test', async (req, res) => {
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
                }
                else {
                    console.warn(`[Reminder Test] Falha ao entregar lembrete para ${phone}`);
                }
            }
            catch (err) {
                console.error('[Reminder Test Async Error]:', err.message);
            }
        }, delayMs);
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -------------------------------------------------------------
// PÁGINA PÚBLICA DE AUTO-AGENDAMENTO
// -------------------------------------------------------------
app.get('/agendar/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/booking.html'));
});
app.get('/agendar/:slug/:profId', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/booking.html'));
});
// -------------------------------------------------------------
// API PÚBLICA PARA O PORTAL DE AGENDAMENTO
// -------------------------------------------------------------
app.get('/api/public/tenants/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;
        let tenant = await dbRepository.getTenantBySlug(slug);
        if (!tenant) {
            tenant = await dbRepository.getTenantById(slug);
        }
        if (!tenant) {
            return res.status(404).json({ error: 'Estabelecimento não encontrado.' });
        }
        const services = await dbRepository.listServices(tenant.id);
        const professionals = await dbRepository.listProfessionals(tenant.id);
        res.json({
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            businessInfo: tenant.aiConfig?.businessInfo || '',
            bookingRules: tenant.bookingRules || {
                bufferTimeMinutes: 10,
                minimumNoticeMinutes: 60,
                maxFutureDays: 30,
                roundRobinEnabled: true
            },
            services: services.map(s => ({
                id: s.id,
                name: s.name,
                price: s.price,
                durationMinutes: s.durationMinutes,
                description: s.description
            })),
            professionals: professionals.map(p => ({
                id: p.id,
                name: p.name,
                servicesHandled: p.servicesHandled
            }))
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/public/tenants/:slug/slots', async (req, res) => {
    try {
        const slug = req.params.slug;
        let tenant = await dbRepository.getTenantBySlug(slug);
        if (!tenant)
            tenant = await dbRepository.getTenantById(slug);
        if (!tenant)
            return res.status(404).json({ error: 'Estabelecimento não encontrado.' });
        const { serviceId, professionalId, dateStr } = req.body;
        if (!serviceId || !dateStr) {
            return res.status(400).json({ error: 'serviceId e dateStr são obrigatórios.' });
        }
        const services = await dbRepository.listServices(tenant.id);
        const service = services.find(s => s.id === serviceId) || services[0];
        const duration = service ? service.durationMinutes : 30;
        const allProfs = await dbRepository.listProfessionals(tenant.id);
        let targetProfs = allProfs;
        if (professionalId && professionalId !== 'ALL' && professionalId !== 'null') {
            targetProfs = allProfs.filter(p => p.id === professionalId);
        }
        else {
            targetProfs = allProfs.filter(p => !p.servicesHandled || p.servicesHandled.length === 0 || p.servicesHandled.includes(serviceId));
        }
        if (targetProfs.length === 0)
            targetProfs = allProfs;
        const bufferMinutes = service?.bufferTimeMinutes ?? tenant.bookingRules?.bufferTimeMinutes ?? 10;
        const minNotice = tenant.bookingRules?.minimumNoticeMinutes ?? 60;
        const maxFutureDays = tenant.bookingRules?.maxFutureDays ?? 30;
        const tenantDailyLimit = dbRepository.getTenantDailyAppointmentLimit(tenant);
        const tenantDayCount = await dbRepository.getDailyAppointmentCountForTenant(tenant.id, dateStr);
        if (tenantDailyLimit !== undefined && tenantDayCount >= tenantDailyLimit) {
            return res.json({ success: true, dateStr, slots: [], limitReached: true, message: 'Capacidade máxima diária de agendamentos deste estabelecimento atingida para esta data.' });
        }
        const allUniqueSlots = new Set();
        for (const prof of targetProfs) {
            const profSchedule = prof.workSchedule || { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' };
            const existingAppts = await dbRepository.getAppointmentsForProfessional(prof.id, dateStr);
            const blocks = await dbRepository.getScheduleBlocks(tenant.id, prof.id, dateStr);
            const dayCount = await dbRepository.getDailyAppointmentCount(prof.id, dateStr);
            const slots = calculateAvailableSlots({
                dateStr,
                serviceDurationMinutes: duration,
                schedule: profSchedule,
                existingAppointments: existingAppts.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
                scheduleBlocks: blocks.map(b => ({ startTime: b.startTime, endTime: b.endTime })),
                maxAppointmentsPerDay: prof.maxAppointmentsPerDay,
                currentDayAppointmentCount: dayCount,
                maxDailyAppointmentsForTenant: tenantDailyLimit,
                currentTenantDailyAppointmentCount: tenantDayCount,
                bufferTimeMinutes: bufferMinutes,
                minimumNoticeMinutes: minNotice,
                maxFutureDays: maxFutureDays,
                slotIntervalMinutes: 30
            });
            for (const s of slots)
                allUniqueSlots.add(s);
        }
        const sortedSlots = Array.from(allUniqueSlots).sort();
        res.json({ success: true, dateStr, slots: sortedSlots });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/public/tenants/:slug/book', async (req, res) => {
    try {
        const slug = req.params.slug;
        let tenant = await dbRepository.getTenantBySlug(slug);
        if (!tenant)
            tenant = await dbRepository.getTenantById(slug);
        if (!tenant)
            return res.status(404).json({ error: 'Estabelecimento não encontrado.' });
        const { serviceId, professionalId, dateStr, timeStr, customerName, customerPhone, notes } = req.body;
        if (!serviceId || !dateStr || !timeStr || !customerName || !customerPhone) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
        }
        const tenantDailyLimit = dbRepository.getTenantDailyAppointmentLimit(tenant);
        const tenantDayCount = await dbRepository.getDailyAppointmentCountForTenant(tenant.id, dateStr);
        if (tenantDailyLimit !== undefined && tenantDayCount >= tenantDailyLimit) {
            return res.status(400).json({ error: 'O limite diário de agendamentos deste estabelecimento foi atingido para esta data. Por favor, escolha outro dia.' });
        }
        const cleanPhone = customerPhone.replace(/\D/g, '');
        const cleanName = customerName.trim();
        const services = await dbRepository.listServices(tenant.id);
        const service = services.find(s => s.id === serviceId) || services[0];
        const duration = service ? service.durationMinutes : 30;
        const allProfs = await dbRepository.listProfessionals(tenant.id);
        let chosenProf = allProfs.find(p => p.id === professionalId);
        // Se não escolheu profissional, usa Round-Robin
        if (!chosenProf) {
            const candidates = [];
            const eligibleProfs = allProfs.filter(p => !p.servicesHandled || p.servicesHandled.length === 0 || p.servicesHandled.includes(serviceId));
            const pool = eligibleProfs.length > 0 ? eligibleProfs : allProfs;
            for (const prof of pool) {
                const profSchedule = prof.workSchedule || { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' };
                const existingAppts = await dbRepository.getAppointmentsForProfessional(prof.id, dateStr);
                const blocks = await dbRepository.getScheduleBlocks(tenant.id, prof.id, dateStr);
                const dayCount = await dbRepository.getDailyAppointmentCount(prof.id, dateStr);
                const slots = calculateAvailableSlots({
                    dateStr,
                    serviceDurationMinutes: duration,
                    schedule: profSchedule,
                    existingAppointments: existingAppts.map(a => ({ startTime: a.startTime, endTime: a.endTime })),
                    scheduleBlocks: blocks.map(b => ({ startTime: b.startTime, endTime: b.endTime })),
                    maxAppointmentsPerDay: prof.maxAppointmentsPerDay,
                    currentDayAppointmentCount: dayCount,
                    bufferTimeMinutes: service?.bufferTimeMinutes ?? tenant.bookingRules?.bufferTimeMinutes ?? 10,
                    minimumNoticeMinutes: tenant.bookingRules?.minimumNoticeMinutes ?? 60,
                    maxFutureDays: tenant.bookingRules?.maxFutureDays ?? 30,
                    slotIntervalMinutes: 30
                });
                candidates.push({
                    id: prof.id,
                    name: prof.name,
                    phone: prof.phone,
                    todayCount: dayCount,
                    availableSlots: slots
                });
            }
            const selected = selectRoundRobinProfessional(candidates, timeStr);
            if (selected) {
                chosenProf = allProfs.find(p => p.id === selected.id);
            }
            else {
                chosenProf = pool[0] || allProfs[0];
            }
        }
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hours, minutes] = timeStr.split(':').map(Number);
        const pad = (n) => String(n).padStart(2, '0');
        const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00-03:00`;
        const startTime = new Date(localIso);
        const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
        const appt = await dbRepository.createAppointment({
            tenantId: tenant.id,
            professionalId: chosenProf?.id || 'prof-1',
            serviceId: service.id,
            customerName: cleanName,
            customerPhone: cleanPhone,
            startTime,
            endTime,
            status: 'CONFIRMED'
        });
        // Atualiza perfil do cliente
        await dbRepository.incrementVisitCount(tenant.id, cleanPhone, chosenProf?.id, service.id);
        // Dispara webhook
        await webhookService.dispatch(tenant.id, 'booking.created', {
            ...appt,
            serviceName: service.name,
            professionalName: chosenProf?.name,
            notes
        });
        // Envia WhatsApp de confirmação para o cliente
        const [y, m, d] = dateStr.split('-');
        const clientMsg = `Olá *${cleanName}*! Seu agendamento foi *CONFIRMADO* com sucesso! 🎉\n\n🏢 *${tenant.name}*\n✂️ *Serviço:* ${service.name}\n👤 *Profissional:* ${chosenProf?.name || 'Equipe'}\n📅 *Data:* ${d}/${m}\n⏰ *Horário:* ${timeStr}\n\nTe esperamos lá! Se precisar de algo, é só responder por aqui. 😊`;
        try {
            await whatsappService.sendMessage(tenant.id, cleanPhone, clientMsg);
        }
        catch (e) {
            console.warn('[Public Booking WhatsApp Client Notice]:', e.message);
        }
        // Envia WhatsApp para o profissional
        if (chosenProf?.phone) {
            const profMsg = `🔔 *Novo agendamento online via Portal!*\n\nCliente: *${cleanName}*\nServiço: *${service.name}*\nData: *${d}/${m}*\nHorário: *${timeStr}*\nWhatsApp: ${cleanPhone}\n\nBoa sorte! 😊`;
            try {
                await whatsappService.sendMessage(tenant.id, chosenProf.phone, profMsg);
            }
            catch (e) {
                console.warn('[Public Booking WhatsApp Prof Notice]:', e.message);
            }
        }
        res.json({ success: true, appointment: appt });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// -------------------------------------------------------------
// REGRAS DE AGENDAMENTO & WEBHOOK CONFIGS
// -------------------------------------------------------------
app.put('/api/tenants/:id/booking-rules', async (req, res) => {
    try {
        const { bufferTimeMinutes, minimumNoticeMinutes, maxFutureDays, roundRobinEnabled, webhookUrl } = req.body;
        const updated = await dbRepository.updateTenantBookingRules(req.params.id, {
            ...(bufferTimeMinutes !== undefined && { bufferTimeMinutes: Number(bufferTimeMinutes) }),
            ...(minimumNoticeMinutes !== undefined && { minimumNoticeMinutes: Number(minimumNoticeMinutes) }),
            ...(maxFutureDays !== undefined && { maxFutureDays: Number(maxFutureDays) }),
            ...(roundRobinEnabled !== undefined && { roundRobinEnabled: Boolean(roundRobinEnabled) }),
            ...(webhookUrl !== undefined && { webhookUrl: String(webhookUrl).trim() })
        });
        res.json({ success: true, bookingRules: updated?.bookingRules });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/tenants/:id/webhook-test', async (req, res) => {
    try {
        const { webhookUrl } = req.body;
        const tenant = await dbRepository.getTenantById(req.params.id);
        const result = await webhookService.testPing(webhookUrl, tenant?.name || 'Estabelecimento');
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// Rota de fallback para servir o Painel Web Assinante SPA
app.get('*', (req, res) => {
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
    const handleGracefulShutdown = async (signal) => {
        console.log(`\n[Server] Recebido sinal ${signal}. Encerrando conexões com segurança...`);
        try {
            server.close();
            console.log('[Server] Servidor HTTP finalizado com sucesso.');
        }
        catch (e) { }
        process.exit(0);
    };
    process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
}
export default app;
