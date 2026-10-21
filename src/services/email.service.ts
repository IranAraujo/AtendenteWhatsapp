import nodemailer, { Transporter } from 'nodemailer';
import logger from '../utils/logger.js';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private transporter: Transporter | null = null;
  private fromAddress: string;

  constructor() {
    this.fromAddress = process.env.SMTP_FROM || '"WhatsApp Atendente" <nao-responda@atendenteia.com.br>';
    this.initTransporter();
  }

  private initTransporter() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });
      logger.info(`[Email Service] Configurado com sucesso via SMTP (${host}:${port})`);
    } else {
      logger.info('[Email Service] Variáveis SMTP não configuradas. Operando em modo de desenvolvimento (console logging).');
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    const { to, subject, html, text } = options;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to,
          subject,
          html,
          text: text || html.replace(/<[^>]+>/g, '')
        });
        logger.info(`[Email Service] E-mail enviado com sucesso para: ${to}`);
        return true;
      } catch (err: any) {
        logger.error(`[Email Service] Erro ao disparar e-mail via SMTP para ${to}:`, err.message);
      }
    }

    // Fallback de desenvolvimento: exibe de forma clara no terminal
    console.log('\n======================================================');
    console.log(`📨 [EMAIL DEV FALLBACK] Para: ${to}`);
    console.log(`📋 Assunto: ${subject}`);
    console.log(`📝 Conteúdo:`);
    console.log(text || html.replace(/<[^>]+>/g, '').trim());
    console.log('======================================================\n');
    return true;
  }

  async sendVerificationEmail(data: { email: string; name: string; code: string; token: string; appUrl?: string }): Promise<boolean> {
    const { email, name, code, token } = data;
    const appUrl = data.appUrl || process.env.APP_URL || 'http://localhost:3001';
    const verifyLink = `${appUrl}/verify-email?email=${encodeURIComponent(email)}&token=${token}`;

    const subject = `${code} é o seu código de confirmação - WhatsApp Atendente IA`;
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 24px; color: #111b21; }
        .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e9edef; }
        .header { background: linear-gradient(135deg, #00a884, #008069); padding: 32px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.9; }
        .content { padding: 32px 28px; line-height: 1.6; font-size: 15px; }
        .code-box { background: #f0fdf4; border: 2px dashed #00a884; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }
        .code-value { font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #008069; font-family: monospace; }
        .btn-link { display: block; text-align: center; background: #00a884; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 24px; border-radius: 8px; margin: 24px 0; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>WhatsApp Atendente IA</h1>
          <p>Confirmação de Cadastro e Ativação de Conta</p>
        </div>
        <div class="content">
          <p>Olá, <strong>${name}</strong>!</p>
          <p>Seja bem-vindo(a) à nossa plataforma de atendimento inteligente. Para confirmar seu endereço de e-mail e ativar o seu painel, utilize o código de 6 dígitos abaixo:</p>
          
          <div class="code-box">
            <div style="font-size: 12px; font-weight: 700; color: #008069; text-transform: uppercase; margin-bottom: 6px;">Seu Código de Verificação</div>
            <div class="code-value">${code}</div>
          </div>

          <p style="text-align: center; margin: 20px 0 10px; font-size: 13px; color: #64748b;">Ou se preferir, ative diretamente com um clique:</p>
          <a href="${verifyLink}" class="btn-link">Confirmar e Ativar Minha Conta ➔</a>

          <p style="font-size: 12px; color: #64748b; margin-top: 24px;">Este código é válido por 24 horas. Se você não solicitou este cadastro, por favor desconsidere este e-mail.</p>
        </div>
        <div class="footer">
          © ${new Date().getFullYear()} WhatsApp Atendente IA - Gestão e Agendamento Automatizado.
        </div>
      </div>
    </body>
    </html>
    `;

    const text = `Olá ${name}!\n\nSeu código de confirmação no WhatsApp Atendente IA é: ${code}\n\nOu ative diretamente pelo link:\n${verifyLink}\n\nVálido por 24 horas.`;
    return this.sendEmail({ to: email, subject, html, text });
  }

  async sendPasswordResetEmail(data: { email: string; name: string; token: string; appUrl?: string }): Promise<boolean> {
    const { email, name, token } = data;
    const appUrl = data.appUrl || process.env.APP_URL || 'http://localhost:3001';
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    const subject = `Recuperação de Senha - WhatsApp Atendente IA`;
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 24px; color: #111b21; }
        .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e9edef; }
        .header { background: linear-gradient(135deg, #00a884, #008069); padding: 32px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .content { padding: 32px 28px; line-height: 1.6; font-size: 15px; }
        .btn-link { display: block; text-align: center; background: #00a884; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 24px; border-radius: 8px; margin: 24px 0; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Redefinição de Senha</h1>
        </div>
        <div class="content">
          <p>Olá, <strong>${name}</strong>!</p>
          <p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>WhatsApp Atendente IA</strong>.</p>
          <p>Clique no botão abaixo para escolher uma nova senha de acesso:</p>

          <a href="${resetLink}" class="btn-link">Criar Nova Senha ➔</a>

          <p style="font-size: 12px; color: #64748b; margin-top: 24px;">Este link expira em 1 hora. Se você não solicitou a redefinição de senha, nenhuma ação é necessária.</p>
        </div>
        <div class="footer">
          © ${new Date().getFullYear()} WhatsApp Atendente IA.
        </div>
      </div>
    </body>
    </html>
    `;

    const text = `Olá ${name}!\n\nRecebemos uma solicitação de redefinição de senha para sua conta.\n\nAcesse o link para redefinir:\n${resetLink}\n\nVálido por 1 hora.`;
    return this.sendEmail({ to: email, subject, html, text });
  }
}

export const emailService = new EmailService();
