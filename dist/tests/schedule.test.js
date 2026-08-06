import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateAvailableSlots, parseDateTime } from '../services/schedule.service.js';
describe('Schedule Engine - Testes de Cálculo de Horários Livres', () => {
    it('deve retornar todos os slots num dia sem agendamentos nem almoço', () => {
        const slots = calculateAvailableSlots({
            dateStr: '2026-08-10',
            serviceDurationMinutes: 30,
            schedule: {
                startTime: '08:00',
                endTime: '10:00',
                lunchStartTime: null,
                lunchEndTime: null,
            },
            existingAppointments: [],
            slotIntervalMinutes: 30,
        });
        assert.deepStrictEqual(slots, ['08:00', '08:30', '09:00', '09:30']);
    });
    it('deve ignorar slots durante o horário de almoço', () => {
        const slots = calculateAvailableSlots({
            dateStr: '2026-08-10',
            serviceDurationMinutes: 60,
            schedule: {
                startTime: '08:00',
                endTime: '14:00',
                lunchStartTime: '12:00',
                lunchEndTime: '13:00',
            },
            existingAppointments: [],
            slotIntervalMinutes: 60,
        });
        // 08:00-09:00 (ok), 09:00-10:00 (ok), 10:00-11:00 (ok), 11:00-12:00 (ok), 12:00-13:00 (almoço), 13:00-14:00 (ok)
        assert.deepStrictEqual(slots, ['08:00', '09:00', '10:00', '11:00', '13:00']);
    });
    it('deve remover slots que conflitam com agendamentos já existentes', () => {
        const existingAppointments = [
            {
                startTime: parseDateTime('2026-08-10', '09:00'),
                endTime: parseDateTime('2026-08-10', '10:00'),
            }
        ];
        const slots = calculateAvailableSlots({
            dateStr: '2026-08-10',
            serviceDurationMinutes: 45,
            schedule: {
                startTime: '08:00',
                endTime: '12:00',
                lunchStartTime: null,
                lunchEndTime: null,
            },
            existingAppointments,
            slotIntervalMinutes: 30,
        });
        // 08:00 às 08:45 (OK)
        // 08:30 às 09:15 (CONFLITO com agendamento das 09:00) -> exclui
        // 09:00 às 09:45 (CONFLITO) -> exclui
        // 09:30 às 10:15 (CONFLITO) -> exclui
        // 10:00 às 10:45 (OK)
        // 10:30 às 11:15 (OK)
        // 11:00 às 11:45 (OK)
        // 11:30 às 12:15 (CONFLITO - ultrapassa expediente) -> exclui
        assert.deepStrictEqual(slots, ['08:00', '10:00', '10:30', '11:00']);
    });
    it('deve retornar array vazio se for dia de folga/exceção', () => {
        const slots = calculateAvailableSlots({
            dateStr: '2026-08-10',
            serviceDurationMinutes: 30,
            schedule: {
                startTime: '08:00',
                endTime: '18:00',
            },
            isExceptionUnavailable: true,
            existingAppointments: [],
        });
        assert.deepStrictEqual(slots, []);
    });
});
