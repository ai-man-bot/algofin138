import { useState, useEffect, Suspense, lazy } from 'react';
import { LoginPage } from './components/LoginPage';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { PWAInstallPrompt, PWAUpdateNotification } from './components/PWAInstallPrompt';
import { setAccessToken, clearAccessToken, setAuthErrorCallback } from './utils/api';
import { projectId, publicAnonKey } from './utils/supabase/info';
import { createClient } from '@supabase/supabase-js';
import { initializePWA } from './utils/pwa';
import './utils/seedData'; // Import seed data utilities
import './utils/pwaCheck'; // Import PWA health check (exposes checkPWAHealth() in console)
import './utils/debugUtils'; // Import debug utilities (exposes debugAlgoFin in console)

type Screen = 'login' | 'reset-password' | 'dashboard' | 'trades' | 'brokers' | 'strategy' | 'webhooks' | 'notifications' | 'account' | 'webhook-debug' | 'analytics' | 'performance';

const Dashboard = lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })));
const TradesTab = lazy(() => import('./components/TradesTab').then((module) => ({ default: module.TradesTab })));
const BrokersPage = lazy(() => import('./components/BrokersPage').then((module) => ({ default: module.BrokersPage })));
const StrategyPage = lazy(() => import('./components/StrategyPage').then((module) => ({ default: module.StrategyPage })));
const WebhooksPage = lazy(() => import('./components/WebhooksPage').then((module) => ({ default: module.WebhooksPage })));
const NotificationsPage = lazy(() => import('./components/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const AccountPage = lazy(() => import('./components/AccountPage').then((module) => ({ default: module.AccountPage })));
const WebhookDebugPage = lazy(() => import('./components/WebhookDebugPage').then((module) => ({ default: module.WebhookDebugPage })));
const AnalyticsPage = lazy(() => import('./components/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })));
const PerformanceAnalyticsPage = lazy(() => import('./components/PerformanceAnalyticsPage').then((module) => ({ default: module.PerformanceAnalyticsPage })));

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>(''); // Shared broker account state
  const screenFallback = <div className="px-6 py-10 text-sm text-slate-400">Loading screen...</div>;

  // Initialize PWA on mount
  useEffect(() => {
    initializePWA();
  }, []);

  useEffect(() => {
    checkSession();
    
    // Set up auth error callback to auto-logout on 401 errors
    setAuthErrorCallback(() => {
      console.warn('🚨 Auth error callback triggered - logging out user');
      handleLogout();
    });
    
    // Log that we're starting up
    console.log('🚀 AlgoFin.ai starting...');
    console.log('📡 Backend: Real user authentication enabled');
  }, []);

  // CRITICAL: Check for password reset on every hash change
  useEffect(() => {
    const checkForPasswordReset = () => {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const type = hashParams.get('type');
      const accessToken = hashParams.get('access_token');
      
      if (type === 'recovery' && accessToken) {
        console.log('🔐 Password reset detected in hash change - switching to reset page');
        setCurrentScreen('reset-password');
        setIsLoggedIn(false); // Make sure we're not logged in
      }
    };
    
    checkForPasswordReset();
    
    // Listen for hash changes
    window.addEventListener('hashchange', checkForPasswordReset);
    return () => window.removeEventListener('hashchange', checkForPasswordReset);
  }, []);

  const checkSession = async () => {
    // Create Supabase client
    const supabaseUrl = `https://${projectId}.supabase.co`;
    const supabase = createClient(supabaseUrl, publicAnonKey);
    
    // FIRST: Check if this is a password reset callback (highest priority)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    const accessToken = hashParams.get('access_token');
    
    console.log('🔍 Checking URL hash...');
    console.log('  - Hash:', window.location.hash);
    console.log('  - Type:', type);
    console.log('  - Has access_token:', !!accessToken);
    
    if (type === 'recovery' && accessToken) {
      console.log('🔐 Password reset flow detected - redirecting to reset page');
      setCurrentScreen('reset-password');
      return;
    }
    
    // SECOND: Check for OAuth callback (Google sign-in redirect)
    // But skip if we're in a recovery flow
    const { data: { session: oauthSession }, error: oauthError } = await supabase.auth.getSession();
    
    if (oauthSession && oauthSession.access_token && type !== 'recovery') {
      console.log('✅ OAuth session found - user authenticated via Google');
      
      const user = oauthSession.user;
      const email = user.email || '';
      const name = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];
      const token = oauthSession.access_token;
      
      // Store session
      const sessionData = { email, name, token };
      localStorage.setItem('algofinSession', JSON.stringify(sessionData));
      
      setIsLoggedIn(true);
      setUserEmail(email);
      setUserName(name);
      setCurrentScreen('dashboard');
      setAccessToken(token);
      
      console.log('✅ Google OAuth login successful:', email);
      return;
    }
    
    // THIRD: Check localStorage for existing session
    const session = localStorage.getItem('algofinSession');
    if (session) {
      try {
        const sessionData = JSON.parse(session);
        
        // Validate that we have a token
        if (!sessionData.token) {
          console.warn('❌ No token in session, clearing');
          localStorage.removeItem('algofinSession');
          return;
        }
        
        // Check for old invalid demo tokens and clear them
        if (sessionData.token === 'demo-token' || sessionData.token === 'demo-google-token' || sessionData.token === 'USE_ANON_KEY') {
          console.warn('❌ Detected old invalid demo token. Clearing session');
          localStorage.removeItem('algofinSession');
          return;
        }
        
        // Validate the token format - must be a valid JWT
        const isValidFormat = sessionData.token.startsWith('eyJ');
        if (!isValidFormat) {
          console.warn('❌ Invalid token format, clearing session');
          localStorage.removeItem('algofinSession');
          return;
        }
        
        // IMPORTANT: Validate the token with Supabase to check if it's expired
        try {
          const { data: { user }, error: tokenError } = await supabase.auth.getUser(sessionData.token);
          
          if (tokenError || !user) {
            console.warn('❌ Token validation failed (expired or invalid). Clearing session.');
            console.warn('  Error:', tokenError?.message);
            localStorage.removeItem('algofinSession');
            
            // Reset UI state to logged out
            setIsLoggedIn(false);
            setUserEmail('');
            setUserName('');
            setAccessToken(null);
            setCurrentScreen('login');
            
            alert('Your session has expired. Please log in again.');
            return;
          }
          
          console.log('✅ Token validated successfully for user:', user.email);
        } catch (validationError) {
          console.warn('❌ Error validating token:', validationError);
          localStorage.removeItem('algofinSession');
          
          // Reset UI state to logged out
          setIsLoggedIn(false);
          setUserEmail('');
          setUserName('');
          setAccessToken(null);
          setCurrentScreen('login');
          
          alert('Your session has expired. Please log in again.');
          return;
        }
        
        console.log('✅ Restoring valid session. Token:', sessionData.token.substring(0, 30) + '...');
        
        setIsLoggedIn(true);
        setUserEmail(sessionData.email || '');
        setUserName(sessionData.name || '');
        setCurrentScreen('dashboard');
        setAccessToken(sessionData.token);
      } catch (err) {
        console.error('❌ Error parsing session:', err);
        localStorage.removeItem('algofinSession');
      }
    } else {
      console.log('ℹ️ No existing session found');
    }
  };

  const handleLogin = async (email: string, name: string, token?: string) => {
    // Clear any existing session first
    localStorage.removeItem('algofinSession');
    
    // Store new session in localStorage
    const sessionData = { email, name, token };
    localStorage.setItem('algofinSession', JSON.stringify(sessionData));
    
    console.log('Login successful. Token:', token ? `${token.substring(0, 20)}...` : 'No token');
    
    setUserEmail(email);
    setUserName(name);
    setAccessToken(token || '');
    setIsLoggedIn(true);
    setCurrentScreen('dashboard');
  };

  const handleLogout = async () => {
    // Create Supabase client
    const supabaseUrl = `https://${projectId}.supabase.co`;
    const supabase = createClient(supabaseUrl, publicAnonKey);
    
    // Sign out from Supabase (clears OAuth session)
    await supabase.auth.signOut();
    
    // Clear local session
    localStorage.removeItem('algofinSession');
    setIsLoggedIn(false);
    setUserEmail('');
    setUserName('');
    setCurrentScreen('login');
    clearAccessToken();
    
    console.log('✅ User logged out successfully');
  };

  const handlePasswordReset = () => {
    // Clear the URL hash and redirect to login
    window.location.hash = '';
    setCurrentScreen('login');
  };

  // Show reset password page if on reset flow
  if (currentScreen === 'reset-password') {
    return <ResetPasswordPage onPasswordReset={handlePasswordReset} />;
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      {/* Top Navigation Bar */}
      <nav className="border-b border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <h1 className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                AlgoFin.ai
              </h1>
              <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
                <button
                  onClick={() => setCurrentScreen('dashboard')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'dashboard'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setCurrentScreen('strategy')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'strategy'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Strategy
                </button>
                <button
                  onClick={() => setCurrentScreen('trades')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'trades'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Trades
                </button>
                <button
                  onClick={() => setCurrentScreen('analytics')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'analytics'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Analytics
                </button>
                <button
                  onClick={() => setCurrentScreen('performance')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'performance'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Performance
                </button>
                <button
                  onClick={() => setCurrentScreen('webhooks')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'webhooks'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Webhooks
                </button>
                <button
                  onClick={() => setCurrentScreen('brokers')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'brokers'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Brokers
                </button>
                <button
                  onClick={() => setCurrentScreen('notifications')}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    currentScreen === 'notifications'
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Notifications
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-slate-100">{userName || 'User'}</p>
                <p className="text-xs text-slate-400">{userEmail}</p>
              </div>
              <button
                onClick={() => setCurrentScreen('account')}
                className={`rounded-lg p-2 transition-colors ${
                  currentScreen === 'account'
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main>
        <Suspense fallback={screenFallback}>
          {currentScreen === 'dashboard' && <Dashboard onNavigate={setCurrentScreen} selectedBrokerId={selectedBrokerId} setSelectedBrokerId={setSelectedBrokerId} />}
          {currentScreen === 'strategy' && <StrategyPage onNavigate={setCurrentScreen} />}
          {currentScreen === 'trades' && <TradesTab selectedBrokerId={selectedBrokerId} setSelectedBrokerId={setSelectedBrokerId} />}
          {currentScreen === 'analytics' && <AnalyticsPage />}
          {currentScreen === 'performance' && <PerformanceAnalyticsPage />}
          {currentScreen === 'webhooks' && <WebhooksPage />}
          {currentScreen === 'brokers' && <BrokersPage />}
          {currentScreen === 'notifications' && <NotificationsPage />}
          {currentScreen === 'account' && <AccountPage userName={userName} userEmail={userEmail} onLogout={handleLogout} />}
          {currentScreen === 'webhook-debug' && <WebhookDebugPage />}
        </Suspense>
      </main>
      
      {/* PWA Install Prompt */}
      <PWAInstallPrompt />
      
      {/* PWA Update Notification */}
      <PWAUpdateNotification />
    </div>
  );
}
