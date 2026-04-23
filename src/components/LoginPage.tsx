import { useEffect, useState } from 'react';
import { Mail, Lock, Chrome } from './CustomIcons';
import { setAccessToken } from '../utils/api';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface LoginPageProps {
  onLogin: (email: string, name: string, token?: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Clear any old sessions on mount
  useEffect(() => {
    const session = localStorage.getItem('algofinSession');
    if (session) {
      try {
        const data = JSON.parse(session);
        // Clear if it's an old invalid token
        if (data.token && !data.token.startsWith('eyJ')) {
          console.log('Clearing old invalid session on login page');
          localStorage.removeItem('algofinSession');
        }
      } catch (e) {
        console.log('Clearing corrupted session on login page');
        localStorage.removeItem('algofinSession');
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabaseUrl = `https://${projectId}.supabase.co`;
      const supabase = createClient(supabaseUrl, publicAnonKey);

      if (isSignUp) {
        // Sign up directly with Supabase Auth (avoids edge-function auth dependency)
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
            emailRedirectTo: window.location.origin,
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        // Sign in immediately to establish app session
        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginError || !loginData.session) {
          throw loginError || new Error('No session created after signup');
        }

        setAccessToken(loginData.session.access_token);
        onLogin(
          loginData.user?.email || email,
          loginData.user?.user_metadata?.name || name || email.split('@')[0],
          loginData.session.access_token
        );
      } else {
        // Sign in existing user directly with Supabase Auth
        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginError || !loginData.session) {
          throw loginError || new Error('No active session');
        }

        setAccessToken(loginData.session.access_token);
        onLogin(
          loginData.user?.email || email,
          loginData.user?.user_metadata?.name || email.split('@')[0],
          loginData.session.access_token
        );
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    
    try {
      // Create Supabase client for OAuth
      const supabaseUrl = `https://${projectId}.supabase.co`;
      const supabase = createClient(supabaseUrl, publicAnonKey);
      
      console.log('🔐 Initiating Google OAuth...');
      
      // Trigger Google OAuth flow
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Redirect back to current origin
          redirectTo: `${window.location.origin}`,
          // Prompt user to select account every time
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      
      if (error) {
        console.error('❌ Google OAuth error:', error);
        setError(error.message || 'Failed to sign in with Google');
        setLoading(false);
        return;
      }
      
      console.log('✅ Google OAuth initiated, redirecting...');
      // User will be redirected to Google
      // After authentication, they'll come back to our app
      
    } catch (err: any) {
      console.error('Google login error:', err);
      setError(err.message || 'Failed to sign in with Google. Please try again.');
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      if (!email) {
        setError('Please enter your email address');
        setLoading(false);
        return;
      }

      // Create Supabase client
      const supabaseUrl = `https://${projectId}.supabase.co`;
      const supabase = createClient(supabaseUrl, publicAnonKey);

      console.log('📧 Sending password reset email to:', email);

      // Send password reset email - redirect to current origin
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });

      if (error) {
        console.error('❌ Password reset error:', error);
        setError(error.message || 'Failed to send reset email');
        setLoading(false);
        return;
      }

      console.log('✅ Password reset email sent');
      setSuccessMessage('Password reset email sent! Check your inbox.');
      
      // After 3 seconds, go back to login
      setTimeout(() => {
        setIsForgotPassword(false);
        setSuccessMessage('');
      }, 3000);

    } catch (err: any) {
      console.error('Password reset error:', err);
      setError(err.message || 'Failed to send reset email. Please try again.');
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

      {/* Login Form */}
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
                {isForgotPassword ? 'Reset Password' : (isSignUp ? 'Create Account' : 'Welcome Back')}
              </h2>
              <p className="text-sm text-slate-400">
                {isForgotPassword 
                  ? 'Enter your email to receive a password reset link'
                  : (isSignUp
                    ? 'Start your algorithmic trading journey'
                    : 'Sign in to access your dashboard')
                }
              </p>
            </div>

            {isForgotPassword ? (
              // Forgot Password Form
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-slate-300">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 pl-10 pr-4 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                      placeholder="alex@example.com"
                      required
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
                  disabled={loading}
                  className="w-full rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setError('');
                    setSuccessMessage('');
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 transition-colors hover:bg-slate-800"
                >
                  Back to Sign In
                </button>
              </form>
            ) : (
              // Regular Login/Signup Form
              <form onSubmit={handleSubmit} className="space-y-4">
                {isSignUp && (
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">
                      Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 px-4 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                      placeholder="Alex Chen"
                      required={isSignUp}
                    />
                  </div>
                )}
                
                <div>
                  <label className="mb-2 block text-sm text-slate-300">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 pl-10 pr-4 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                      placeholder="alex@example.com"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-slate-300">
                    Password
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
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/50 p-3 text-sm text-rose-400">
                    {error}
                  </div>
                )}

                {!isSignUp && (
                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2 text-slate-400">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-500"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      className="text-blue-400 hover:text-blue-300"
                      onClick={() => setIsForgotPassword(true)}
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  {loading ? 'Processing...' : (isSignUp ? 'Create Account' : 'Sign In')}
                </button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-700"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="bg-slate-900/30 px-4 text-slate-400">
                      Or continue with
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-3 transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  <Chrome className="h-5 w-5" />
                  Sign {isSignUp ? 'up' : 'in'} with Google
                </button>
              </form>
            )}

            <div className="mt-6 text-center text-sm text-slate-400">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-blue-400 hover:text-blue-300"
              >
                {isSignUp ? 'Sign In' : 'Sign Up'}
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
          
          {/* Debug: Force clear button */}
          <div className="mt-4 text-center">
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="text-xs text-rose-400 hover:text-rose-300 underline"
            >
              🔧 Clear All Data & Refresh (Debug)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
