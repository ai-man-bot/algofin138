import { useState, useEffect } from 'react';
import { Bell, Mail, MessageSquare, Smartphone, Check, AlertTriangle, TrendingUp, TrendingDown, DollarSign, X, RefreshCw } from './CustomIcons';
import { projectId, publicAnonKey } from '../utils/supabase/info';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata?: any;
  read: boolean;
  createdAt: string;
  timestamp?: string;
}

interface NotificationSettings {
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  tradeAlerts: boolean;
  priceAlerts: boolean;
  strategyAlerts: boolean;
  systemAlerts: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [settings, setSettings] = useState<NotificationSettings>({
    emailEnabled: true,
    pushEnabled: false,
    smsEnabled: false,
    tradeAlerts: true,
    priceAlerts: true,
    strategyAlerts: true,
    systemAlerts: true,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  });
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    loadNotifications();
    loadSettings();
    checkPushPermission();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkPushPermission = () => {
    if ('Notification' in window) {
      setPushPermission(Notification.permission);
    }
  };

  const requestPushPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      
      if (permission === 'granted') {
        // Update settings to enable push
        const updatedSettings = { ...settings, pushEnabled: true };
        setSettings(updatedSettings);
        await saveSettings(updatedSettings);
        
        // Show a test notification
        new Notification('AlgoFin.ai Notifications Enabled', {
          body: 'You will now receive real-time trading alerts.',
          icon: '/favicon.ico',
        });
      }
    }
  };

  const loadNotifications = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/notifications`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/notification-settings`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async (newSettings?: NotificationSettings) => {
    const settingsToSave = newSettings || settings;
    
    try {
      setSavingSettings(true);
      const token = localStorage.getItem('access_token');
      if (!token) return;

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/notification-settings`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(settingsToSave),
        }
      );

      if (response.ok) {
        console.log('Settings saved successfully');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setSavingSettings(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/notifications/${notificationId}/read`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        setNotifications(notifications.map(n => 
          n.id === notificationId ? { ...n, read: true } : n
        ));
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/notifications/mark-all-read`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        setNotifications(notifications.map(n => ({ ...n, read: true })));
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/notifications/${notificationId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        setNotifications(notifications.filter(n => n.id !== notificationId));
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'trade_filled':
        return { icon: <TrendingUp className="h-5 w-5" />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' };
      case 'trade_rejected':
        return { icon: <TrendingDown className="h-5 w-5" />, color: 'text-rose-400', bg: 'bg-rose-500/10' };
      case 'risk_limit_hit':
        return { icon: <AlertTriangle className="h-5 w-5" />, color: 'text-yellow-400', bg: 'bg-yellow-500/10' };
      case 'strategy_paused':
        return { icon: <AlertTriangle className="h-5 w-5" />, color: 'text-orange-400', bg: 'bg-orange-500/10' };
      case 'webhook_triggered':
        return { icon: <Bell className="h-5 w-5" />, color: 'text-blue-400', bg: 'bg-blue-500/10' };
      case 'info':
        return { icon: <Bell className="h-5 w-5" />, color: 'text-blue-400', bg: 'bg-blue-500/10' };
      case 'warning':
        return { icon: <AlertTriangle className="h-5 w-5" />, color: 'text-yellow-400', bg: 'bg-yellow-500/10' };
      case 'error':
        return { icon: <AlertTriangle className="h-5 w-5" />, color: 'text-rose-400', bg: 'bg-rose-500/10' };
      default:
        return { icon: <DollarSign className="h-5 w-5" />, color: 'text-slate-400', bg: 'bg-slate-500/10' };
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1600px] px-6 py-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Notifications Feed */}
        <div className="lg:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="mb-2 text-slate-100">
                Notifications {unreadCount > 0 && <span className="ml-2 text-sm text-blue-400">({unreadCount} unread)</span>}
              </h2>
              <p className="text-slate-400">Real-time alerts from your trading activity</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={loadNotifications}
                className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
                >
                  <Check className="h-4 w-4" />
                  Mark All Read
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-slate-400">Loading notifications...</div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-12 text-center backdrop-blur-sm">
              <Bell className="mx-auto mb-4 h-16 w-16 text-slate-600" />
              <p className="text-slate-400">No notifications yet</p>
              <p className="mt-2 text-sm text-slate-500">
                You'll receive alerts here when trades are executed, strategies trigger, or system events occur.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => {
                const { icon, color, bg } = getNotificationIcon(notification.type);
                return (
                  <div
                    key={notification.id}
                    className={`rounded-xl border border-slate-700/50 p-4 backdrop-blur-sm transition-all hover:border-slate-600/50 ${
                      notification.read ? 'bg-slate-900/20' : 'bg-slate-900/40'
                    }`}
                    onClick={() => !notification.read && markAsRead(notification.id)}
                  >
                    <div className="flex gap-4">
                      <div className={`rounded-lg p-2 ${bg}`}>
                        <div className={color}>{icon}</div>
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-start justify-between">
                          <h4 className="text-slate-100">{notification.title}</h4>
                          <div className="flex items-center gap-2">
                            {!notification.read && (
                              <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNotification(notification.id);
                              }}
                              className="text-slate-500 transition-colors hover:text-slate-300"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <p className="mb-2 text-sm text-slate-400">{notification.message}</p>
                        <p className="text-xs text-slate-500">
                          {formatTimestamp(notification.createdAt || notification.timestamp || '')}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Settings Sidebar */}
        <div className="space-y-6">
          {/* Notification Channels */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-slate-100">Notification Channels</h3>
            <div className="space-y-4">
              <ChannelToggle
                icon={<Mail className="h-5 w-5" />}
                label="Email"
                sublabel="Coming soon"
                enabled={settings.emailEnabled}
                onChange={(enabled) => setSettings({ ...settings, emailEnabled: enabled })}
                disabled={true}
              />
              <div>
                <ChannelToggle
                  icon={<Smartphone className="h-5 w-5" />}
                  label="Push Notifications"
                  sublabel={
                    pushPermission === 'granted'
                      ? 'Enabled'
                      : pushPermission === 'denied'
                      ? 'Blocked by browser'
                      : 'Click to enable'
                  }
                  enabled={settings.pushEnabled && pushPermission === 'granted'}
                  onChange={(enabled) => {
                    if (enabled && pushPermission !== 'granted') {
                      requestPushPermission();
                    } else {
                      setSettings({ ...settings, pushEnabled: enabled });
                    }
                  }}
                />
                {pushPermission === 'default' && (
                  <button
                    onClick={requestPushPermission}
                    className="mt-2 w-full rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-500/20"
                  >
                    Enable Browser Notifications
                  </button>
                )}
              </div>
              <ChannelToggle
                icon={<MessageSquare className="h-5 w-5" />}
                label="SMS"
                sublabel="Coming soon"
                enabled={settings.smsEnabled}
                onChange={(enabled) => setSettings({ ...settings, smsEnabled: enabled })}
                disabled={true}
              />
            </div>
          </div>

          {/* Alert Types */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-slate-100">Alert Types</h3>
            <div className="space-y-4">
              <AlertTypeToggle
                label="Trade Executions"
                description="Order fills and rejections"
                enabled={settings.tradeAlerts}
                onChange={(enabled) => setSettings({ ...settings, tradeAlerts: enabled })}
              />
              <AlertTypeToggle
                label="Price Alerts"
                description="Target prices reached"
                enabled={settings.priceAlerts}
                onChange={(enabled) => setSettings({ ...settings, priceAlerts: enabled })}
              />
              <AlertTypeToggle
                label="Strategy Alerts"
                description="Performance warnings"
                enabled={settings.strategyAlerts}
                onChange={(enabled) => setSettings({ ...settings, strategyAlerts: enabled })}
              />
              <AlertTypeToggle
                label="System Updates"
                description="Maintenance & reports"
                enabled={settings.systemAlerts}
                onChange={(enabled) => setSettings({ ...settings, systemAlerts: enabled })}
              />
            </div>
          </div>

          {/* Quiet Hours */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-slate-100">Quiet Hours</h3>
            <p className="mb-4 text-sm text-slate-400">
              Pause non-critical notifications during these hours
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Start Time</label>
                <input
                  type="time"
                  value={settings.quietHoursStart}
                  onChange={(e) => setSettings({ ...settings, quietHoursStart: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">End Time</label>
                <input
                  type="time"
                  value={settings.quietHoursEnd}
                  onChange={(e) => setSettings({ ...settings, quietHoursEnd: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  checked={settings.quietHoursEnabled}
                  onChange={(e) => setSettings({ ...settings, quietHoursEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-500"
                />
                Enable quiet hours
              </label>
            </div>
          </div>

          <button
            onClick={() => saveSettings()}
            disabled={savingSettings}
            className="w-full rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {savingSettings ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ChannelToggleProps {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

function ChannelToggle({ icon, label, sublabel, enabled, onChange, disabled }: ChannelToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="text-slate-400">{icon}</div>
        <div>
          <p className="text-sm text-slate-100">{label}</p>
          <p className="text-xs text-slate-500">{sublabel}</p>
        </div>
      </div>
      <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          enabled ? 'bg-blue-500' : 'bg-slate-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        ></div>
      </button>
    </div>
  );
}

interface AlertTypeToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function AlertTypeToggle({ label, description, enabled, onChange }: AlertTypeToggleProps) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <div>
        <p className="text-sm text-slate-100">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-500"
      />
    </label>
  );
}