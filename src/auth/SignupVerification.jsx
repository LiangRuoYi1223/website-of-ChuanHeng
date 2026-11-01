import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '../backend.js';

const RESEND_DELAY = 60_000;

export default function SignupVerification({ email, emailRedirectTo, onVerified, onChangeEmail }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('如果该邮箱可以注册，验证邮件将发送到邮箱。请查收邮件并输入六位验证码。');
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_DELAY);
  const [now, setNow] = useState(Date.now);
  const version = useRef(0);
  const inFlight = useRef(false);
  const tokenInput = useRef(null);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    tokenInput.current?.focus();
    return () => { version.current++; };
  }, []);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  async function verify(event) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(''); setNotice('');
    const token = String(new FormData(event.currentTarget).get('token') || '').trim();
    if (!/^[0-9]{6}$/.test(token)) return setError('请输入邮件中的六位数字验证码。');
    const current = ++version.current;
    const active = () => current === version.current;
    inFlight.current = true; setBusy('verify');
    try {
      const { data, error: verificationError } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (!active()) return;
      if (verificationError) {
        setError(verificationError.status === 429 ? '验证过于频繁，请稍后再试。' : '验证码错误或已过期，请检查后重试，或重新发送验证码。');
        return;
      }
      if (!data?.session?.user?.id) {
        setError('无法确认登录状态，请使用邮箱和密码重新登录。');
        return;
      }
      const { data: verified, error: userError } = await supabase.auth.getUser();
      if (!active()) return;
      if (userError || !verified?.user || verified.user.id !== data.session.user.id || verified.user.email?.toLowerCase() !== email.toLowerCase()) {
        setError('无法确认登录身份，请使用邮箱和密码重新登录。');
        return;
      }
      onVerified();
    } catch {
      if (active()) setError('暂时无法验证邮箱，请检查网络后重试。');
    } finally {
      if (active()) { inFlight.current = false; setBusy(''); }
    }
  }

  async function resend() {
    if (inFlight.current || Date.now() < resendAt) return;
    const current = ++version.current;
    const active = () => current === version.current;
    inFlight.current = true; setBusy('resend'); setError(''); setNotice('');
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } });
      if (!active()) return;
      if (resendError) {
        if (resendError.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(resendError.code)) {
          setResendAt(Date.now() + RESEND_DELAY);
          setError('发送过于频繁，请等待倒计时结束后重试。');
        } else setError('验证邮件未能重新发送，请稍后重试。');
        return;
      }
      setResendAt(Date.now() + RESEND_DELAY);
      if (tokenInput.current) tokenInput.current.value = '';
      setNotice('如果该邮箱仍需验证，新的验证邮件将发送到邮箱。请使用最新邮件中的验证码。');
    } catch {
      if (active()) setError('暂时无法发送邮件，请检查网络后重试。');
    } finally {
      if (active()) { inFlight.current = false; setBusy(''); }
    }
  }

  return <div className="login-verification">
    <p className="login-verification-email">待验证邮箱<strong>{email}</strong></p>
    <form onSubmit={verify} aria-busy={Boolean(busy)}>
      <label>邮箱验证码<input ref={tokenInput} className="login-otp-input" name="token" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="输入六位验证码" minLength={6} maxLength={6} pattern="[0-9]{6}" required disabled={Boolean(busy)} aria-describedby="signup-otp-help" /></label>
      <p className="login-verification-help" id="signup-otp-help">请查看收件箱或垃圾邮件。验证码过期时，可重新发送。</p>
      {error && <div className="login-feedback error" role="alert">{error}</div>}
      {notice && <div className="login-feedback success" role="status">{notice}</div>}
      <button className="login-submit" disabled={Boolean(busy)}>{busy === 'verify' ? '正在验证…' : '验证并登录'}<ArrowRight size={18} /></button>
    </form>
    <div className="login-verification-actions">
      <button type="button" onClick={resend} disabled={Boolean(busy) || remaining > 0}>{busy === 'resend' ? '正在发送…' : remaining > 0 ? `${remaining} 秒后可重发` : '重新发送验证码'}</button>
      <button type="button" onClick={onChangeEmail}>更换邮箱</button>
    </div>
  </div>;
}
