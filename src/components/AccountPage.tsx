import { useState, useEffect } from 'react';
import { User, Mail, Key, Shield, LogOut, Calendar, Code, Copy, Eye, EyeOff, ExternalLink } from './CustomIcons';
import { getAccessToken } from '../utils/api';
import { projectId } from '../utils/supabase/info';

interface AccountPageProps {
  userName: string;
  userEmail: string;
  onLogout: () => void;
}

export function AccountPage({ userName, userEmail, onLogout }: AccountPageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(userName);
  const [createdAt, setCreatedAt] = useState('');
  const [lastSignIn, setLastSignIn] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [accessToken, setAccessToken] = useState('');

  useEffect(() => {
    // Set mock dates for demo purposes
    setCreatedAt(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toLocaleDateString());
    setLastSignIn(new Date().toLocaleString());
    
    // Get access token
    const token = getAccessToken();
    if (token) {
      setAccessToken(token);
    }
  }, []);

  const handleUpdateProfile = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      setSuccess('Profile updated successfully!');
      setIsEditing(false);
      
      // In a real app, this would update the user's name in the backend
      console.log('Profile update:', { name: newName });
    } catch (err: any) {
      console.error('Error updating profile:', err);
      setError(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(accessToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1200px] px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h2 className="mb-2 text-slate-100">Account Settings</h2>
        <p className="text-slate-400">Manage your profile and account preferences</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Profile Section */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile Information */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-slate-100">Profile Information</h3>
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="rounded-lg bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-500/20"
                >
                  Edit Profile
                </button>
              )}
            </div>

            <div className="space-y-4">
              {/* Profile Picture */}
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                  <span className="text-2xl text-white">
                    {userName ? userName.charAt(0).toUpperCase() : 'U'}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Profile Picture</p>
                  <p className="text-xs text-slate-500 mt-1">Your avatar is generated from your initials</p>
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="mb-2 block text-sm text-slate-400">Full Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white outline-none transition-colors focus:border-blue-500"
                  />
                ) : (
                  <div className="flex items-center gap-2 rounded-lg bg-slate-800/30 px-4 py-3">
                    <User className="h-5 w-5 text-slate-500" />
                    <span className="text-slate-100">{userName || 'Not set'}</span>
                  </div>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="mb-2 block text-sm text-slate-400">Email Address</label>
                <div className="flex items-center gap-2 rounded-lg bg-slate-800/30 px-4 py-3">
                  <Mail className="h-5 w-5 text-slate-500" />
                  <span className="text-slate-100">{userEmail}</span>
                  <span className="ml-auto rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
                    Verified
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              {isEditing && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setNewName(userName);
                      setError('');
                      setSuccess('');
                    }}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 py-3 text-slate-300 transition-colors hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateProfile}
                    disabled={saving}
                    className="flex-1 rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}

              {/* Success/Error Messages */}
              {success && (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/50 p-3 text-sm text-emerald-400">
                  {success}
                </div>
              )}
              {error && (
                <div className="rounded-lg bg-rose-500/10 border border-rose-500/50 p-3 text-sm text-rose-400">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Security Section */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
            <h3 className="mb-6 text-slate-100">Security</h3>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-slate-800/30 p-4">
                <div className="flex items-center gap-3">
                  <Key className="h-5 w-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-100">Password</p>
                    <p className="text-xs text-slate-500">Last changed 30 days ago</p>
                  </div>
                </div>
                <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700">
                  Change
                </button>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-slate-800/30 p-4">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-100">Two-Factor Authentication</p>
                    <p className="text-xs text-slate-500">Not enabled</p>
                  </div>
                </div>
                <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700">
                  Enable
                </button>
              </div>
            </div>
          </div>

          {/* API & Developer Section */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
            <div className="mb-6 flex items-center gap-2">
              <Code className="h-5 w-5 text-blue-400" />
              <h3 className="text-slate-100">API & Developer</h3>
            </div>
            
            <div className="space-y-4">
              {/* Access Token */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-slate-400">Access Token</label>
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {showToken ? (
                      <>
                        <EyeOff className="h-3 w-3" />
                        Hide
                      </>
                    ) : (
                      <>
                        <Eye className="h-3 w-3" />
                        Show
                      </>
                    )}
                  </button>
                </div>
                
                <div className="relative">
                  <div className="rounded-lg bg-slate-800/50 border border-slate-700 px-4 py-3 pr-20 font-mono text-xs text-slate-300 overflow-x-auto">
                    {showToken ? accessToken || 'No token available' : '••••••••••••••••••••••••••••••••'}
                  </div>
                  <button
                    onClick={handleCopyToken}
                    disabled={!accessToken}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Copy className="h-3 w-3" />
                    {tokenCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                
                <p className="text-xs text-slate-500 mt-2">
                  Use this token to authenticate API requests and MCP integrations.
                </p>
              </div>

              {/* MCP Server Info */}
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
                <div className="flex items-start gap-3 mb-3">
                  <Code className="h-5 w-5 text-blue-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-blue-400 mb-1">MCP Server Available</p>
                    <p className="text-xs text-slate-300">
                      Connect AI assistants like Claude or Cursor to control AlgoFin.ai with natural language.
                    </p>
                  </div>
                </div>
                
                <div className="space-y-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Endpoint:</span>
                    <code className="text-xs text-slate-300 font-mono">
                      https://{projectId}.supabase.co/functions/v1/make-server-f118884a/mcp
                    </code>
                  </div>
                </div>

                <a
                  href="/MCP_INTEGRATION_GUIDE.md"
                  target="_blank"
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  View MCP Integration Guide
                </a>
              </div>

              {/* Quick Setup */}
              <div className="bg-slate-800/30 rounded-lg p-4">
                <p className="text-xs text-slate-400 mb-2">Quick Setup for Claude Desktop:</p>
                <pre className="bg-slate-950/50 rounded p-3 text-xs text-slate-300 overflow-x-auto">
{`{
  "mcpServers": {
    "algofin": {
      "url": "https://${projectId}.supabase.co/functions/v1/make-server-f118884a/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    }
  }
}`}
                </pre>
                <p className="text-xs text-slate-500 mt-2">
                  Replace YOUR_ACCESS_TOKEN with the token above.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Account Stats */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-slate-100">Account Details</h3>
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Calendar className="h-4 w-4" />
                  <span className="text-xs">Member Since</span>
                </div>
                <p className="text-sm text-slate-100">{createdAt}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <User className="h-4 w-4" />
                  <span className="text-xs">Last Sign In</span>
                </div>
                <p className="text-sm text-slate-100">{lastSignIn}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Shield className="h-4 w-4" />
                  <span className="text-xs">Account Status</span>
                </div>
                <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400"></div>
                  Active
                </span>
              </div>
            </div>
          </div>

          {/* Plan Information */}
          <div className="rounded-xl border border-blue-500/50 bg-blue-500/10 p-6 backdrop-blur-sm">
            <h3 className="mb-2 text-blue-400">Demo Account</h3>
            <p className="mb-4 text-sm text-slate-300">
              You&apos;re using AlgoFin.ai in demo mode with full access to all features.
            </p>
            <button className="w-full rounded-lg bg-blue-500 py-2 text-sm transition-colors hover:bg-blue-600">
              Upgrade to Pro
            </button>
          </div>

          {/* Danger Zone */}
          <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-rose-400">Danger Zone</h3>
            <button
              onClick={onLogout}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/50 bg-rose-500/10 py-3 text-rose-400 transition-colors hover:bg-rose-500/20"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}