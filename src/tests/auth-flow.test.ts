import test from 'node:test';
import assert from 'node:assert';
import { dbRepository } from '../services/db.service.js';
import { hashPassword, comparePassword } from '../services/auth.service.js';

test('Fluxo Comercial de Autenticação, Verificação e Recuperação de Senha', async (t) => {
  const testEmail = `comercial_${Date.now()}@exemplo.com.br`;
  const plainPassword = 'minhasenhasegura123';
  const verificationCode = '654321';
  const verificationToken = 'token-uuid-teste-' + Date.now();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let registeredData: any;

  await t.test('1. Cadastro de Tenant com E-mail Não Verificado', async () => {
    registeredData = await dbRepository.registerTenantAndOwner({
      ownerName: 'Roberto Empresário',
      email: testEmail,
      password: plainPassword,
      companyName: 'Clínica & Escritório Roberto',
      phone: '11999887766',
      planTier: 'MULTI_USER',
      segment: 'saude',
      isEmailVerified: false,
      verificationCode,
      verificationToken,
      verificationExpires: expires
    });

    assert.ok(registeredData.tenant, 'Tenant criado com sucesso');
    assert.ok(registeredData.user, 'Usuário criado com sucesso');
    assert.strictEqual(registeredData.user.isEmailVerified, false, 'Usuário inicializa com e-mail não verificado');
  });

  await t.test('2. Busca de Usuário por Código OTP de Verificação', async () => {
    const foundByCode = await dbRepository.findUserByVerificationCode(testEmail, verificationCode);
    assert.ok(foundByCode, 'Encontrou usuário pelo código de 6 dígitos');
    assert.strictEqual(foundByCode.user.email, testEmail);

    const notFound = await dbRepository.findUserByVerificationCode(testEmail, '999999');
    assert.ok(!notFound, 'Código incorreto não deve encontrar usuário');
  });

  await t.test('3. Confirmação do E-mail e Ativação da Conta', async () => {
    await dbRepository.confirmUserEmail(registeredData.user.id);
    const updated = await dbRepository.findUserByEmail(testEmail);
    assert.ok(updated, 'Encontrou usuário atualizado');
    assert.strictEqual((updated.user as any).isEmailVerified, true, 'isEmailVerified alterado para true');
    assert.strictEqual((updated.user as any).verificationCode, null, 'Código OTP limpo após uso');
  });

  await t.test('4. Geração e Validação de Token de Recuperação de Senha', async () => {
    const resetToken = 'reset-token-hex-' + Date.now();
    const resetExpires = new Date(Date.now() + 3600 * 1000);

    await dbRepository.setPasswordResetToken(testEmail, resetToken, resetExpires);
    const foundReset = await dbRepository.findUserByResetToken(resetToken);
    assert.ok(foundReset, 'Encontrou usuário pelo token de reset');
    assert.strictEqual(foundReset.user.email, testEmail);

    // Atualiza para nova senha
    const newPassword = 'novasenhaultrasegura456';
    const newHash = hashPassword(newPassword);
    await dbRepository.updateUserPassword(registeredData.user.id, newHash);

    const userWithNewPass = await dbRepository.findUserByEmail(testEmail);
    assert.ok(userWithNewPass, 'Usuário encontrado com nova senha');
    assert.ok(comparePassword(newPassword, userWithNewPass.user.passwordHash), 'Nova senha bate com hash armazenado');
    assert.strictEqual(comparePassword(plainPassword, userWithNewPass.user.passwordHash), false, 'Senha antiga não funciona mais');
  });
});
