# How to Get Your Access Token for MCP Integration

## Quick Guide

### Step 1: Navigate to Account Settings
1. Click on your profile/account icon in AlgoFin.ai
2. Select **"Account"** from the navigation menu

### Step 2: Find API & Developer Section
1. Scroll down to the **"API & Developer"** section (it's in the main content area, below Security)
2. You'll see your **Access Token** field (hidden by default for security)

### Step 3: View and Copy Your Token
1. Click the **"Show"** button to reveal your access token
2. Click the **"Copy"** button to copy it to your clipboard
3. The token will show "Copied!" confirmation

## What You'll See

The **API & Developer** section includes:

✅ **Access Token** - Your authentication token (show/hide/copy)
✅ **MCP Server Info** - Endpoint URL and details
✅ **Quick Setup Code** - Ready-to-use configuration for Claude Desktop
✅ **Integration Guide Link** - Full documentation

## Using Your Access Token

### For Claude Desktop

1. **Open Claude Desktop config file:**
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%/Claude/claude_desktop_config.json`

2. **Add this configuration:**
```json
{
  "mcpServers": {
    "algofin": {
      "url": "https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN_HERE"
      }
    }
  }
}
```

3. **Replace:**
   - `YOUR_PROJECT_ID` - Your Supabase project ID (shown in the UI)
   - `YOUR_ACCESS_TOKEN_HERE` - Paste the token you copied

4. **Restart Claude Desktop**

5. **Test it:**
   - Open Claude Desktop
   - Type: "Show me my portfolio"
   - Claude will use the MCP server to fetch your data!

### For Cursor AI

1. **Open Cursor Settings** → MCP Servers

2. **Add AlgoFin.ai server:**
```json
{
  "mcp": {
    "servers": {
      "algofin": {
        "url": "https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp/execute",
        "token": "YOUR_ACCESS_TOKEN_HERE"
      }
    }
  }
}
```

3. **Use in Cursor:**
   - `@algofin show my active strategies`
   - `@algofin buy 100 shares of NVDA`

### For Direct API Calls

```bash
# Get your portfolio
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp/execute \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "algofin_get_portfolio",
    "args": {
      "broker": "all"
    }
  }'
```

## Security Best Practices

🔐 **Keep Your Token Secure:**
- Never share your access token publicly
- Don't commit it to GitHub or version control
- Treat it like a password

🔄 **Token Refresh:**
- Your token is tied to your Supabase session
- If you log out and back in, you'll get a new token
- Update your MCP configuration if the token changes

⚠️ **If Token is Compromised:**
- Log out and log back in to get a new token
- Update all MCP configurations with the new token

## Token Details

**Format:** JWT (JSON Web Token)
**Validity:** Session-based (valid while logged in)
**Scopes:** Full access to your AlgoFin.ai account
**Used For:**
- MCP tool execution
- Direct API calls
- Webhook management
- Strategy operations
- Trade execution

## Troubleshooting

### Token Not Showing
- Make sure you're logged in
- Refresh the page
- Check browser console for errors

### "Unauthorized" Error
- Verify token is copied correctly
- Check for extra spaces or line breaks
- Make sure you're using the latest token
- Try logging out and back in

### Token Too Long
- This is normal - JWT tokens are long
- Make sure to copy the entire token
- Don't truncate or modify it

## Need Help?

📖 **Read the full guide:** `/MCP_INTEGRATION_GUIDE.md`
🔧 **Check server status:** Visit `/mcp/info` endpoint
📊 **View available tools:** Visit `/mcp/tools` endpoint

---

**Ready to start?** Go to Account Settings → API & Developer → Copy your token! 🚀
