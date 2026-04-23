import { useState, useEffect } from 'react';
import { Lock } from './CustomIcons';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface ResetPasswordPageProps {
  onPasswordReset: () => void;
}

export function ResetPasswordPage({ onPasswordReset }: ResetPasswordPageProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [accessToken, setAccessToken] = useState('');

  useEffect(() => {
    // Parse the URL hash to get the access_token
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const token = hashParams.get('access_token');
    const type = hashParams.get('type');

    console.log('🔐 Password Reset Page loaded');
    console.log('Token type:', type);
    console.log('Token present:', !!token);

    if (token && type === 'recovery') {
      setAccessToken(token);
      console.log('✅ Recovery token found');
    } else {
      setError('Invalid or missing recovery token. Please request a new password reset link.');
      console.error('❌ No recovery token found in URL');
    }
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      // Validation
      if (password.length < 6) {
        setError('Password must be at least 6 characters long');
        setLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }

      if (!accessToken) {
        setError('Invalid recovery token. Please request a new password reset link.');
        setLoading(false);
        return;
      }

      // Create Supabase client
      const supabaseUrl = `https://${projectId}.supabase.co`;
      const supabase = createClient(supabaseUrl, publicAnonKey);

      console.log('🔄 Updating password...');

      // Set the session with the recovery token
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: '', // Not needed for password recovery
      });

      if (sessionError) {
        console.error('❌ Session error:', sessionError);
        setError(sessionError.message || 'Failed to verify recovery token');
        setLoading(false);
        return;
      }

      // Update the user's password
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        console.error('❌ Password update error:', updateError);
        setError(updateError.message || 'Failed to update password');
        setLoading(false);
        return;
      }

      console.log('✅ Password updated successfully');
      setSuccessMessage('Password updated successfully! Redirecting to login...');

      // Sign out and redirect to login after 2 seconds
      setTimeout(async () => {
        await supabase.auth.signOut();
        onPasswordReset();
      }, 2000);

    } catch (err: any) {
      console.error('Password reset error:', err);
      setError(err.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0f172a]">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-1/4 top-0 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl"></div>
        <div className="absolute -right-1/4 bottom-0 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl"></div>
        <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"></div>
        <div className="absolute left-1/2 top-1/2 h-full w-px -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-transparent via-blue-500/20 to-transparent"></div>
      </div>

      {/* Reset Password Form */}
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-8 text-center">
            <h1 className="mb-2 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              AlgoFin.ai
            </h1>
            <p className="text-slate-400">
              Institutional-Grade Algorithmic Trading
            </p>
          </div>

          {/* Form Card */}
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 p-8 backdrop-blur-xl">
            <div className="mb-6">
              <h2 className="text-slate-100">
                Reset Your Password
              </h2>
              <p className="text-sm text-slate-400">
                Enter your new password below
              </p>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 pl-10 pr-4 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Minimum 6 characters
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 pl-10 pr-4 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-rose-500/10 border border-rose-500/50 p-3 text-sm text-rose-400">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/50 p-3 text-sm text-emerald-400">
                  {successMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !accessToken}
                className="w-full rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? 'Updating Password...' : 'Reset Password'}
              </button>

              <button
                type="button"
                onClick={onPasswordReset}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 transition-colors hover:bg-slate-800"
              >
                Back to Sign In
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Your password will be encrypted and stored securely
          </p>
        </div>
      </div>
    </div>
  );
}
