import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateAvailableSlots } from './services/schedule.service.js';
import { aiOrchestrator } from './services/ai-orchestrator.service.js';
import { whatsappService } from './services/whatsapp.service.js';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors());
app.use(express.json());
// Servir arquivos estáticos do Painel Web Frontend (public/index.html)
app.use(express.static(path.join(__dirname, '../public')));
const PORT = process.env.PORT || 3000;
// Healthcheck
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        app: 'SaaS Atendente & Agendamento WhatsApp IA',
        version: '1.0.0',
        phase: 'Fase 3 - Painel Web Admin Frontend & Backend Integrados',
        timestamp: new Date().toISOString()
    });
});
// Endpoint de Webhook do WhatsApp (Evolution API / Baileys)
app.post('/api/webhook/whatsapp', async (req, res) => {
    try {
        const result = await whatsappService.handleWebhook(req.body);
        res.json(result);
    }
    catch (error) {
        console.error('[Webhook Error]', error);
        res.status(500).json({ error: error.message });
    }
});
// Endpoint para simulação completa de chat no Painel Admin Web
app.post('/api/chat/simulate', async (req, res) => {
    try {
        const { tenantId = 'tenant-demo-barbearia', customerPhone = '5511999998888', message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Campo "message" é obrigatório.' });
        }
        const aiResult = await aiOrchestrator.processIncomingMessage(tenantId, customerPhone, message);
        res.json({
            success: true,
            tenantId,
            customerPhone,
            message,
            replyText: aiResult.replyText,
            functionCallsExecuted: aiResult.functionCallsExecuted,
            appointmentCreated: aiResult.appointmentCreated || null
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// API de cálculo de horários livres
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
// Rota de fallback para servir o Painel Web Admin SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.listen(PORT, () => {
    console.log(`🚀 Servidor SaaS Backend & Dashboard Web (Fase 3) rodando em http://localhost:${PORT}`);
});
