# Troubleshooting Guide

## Development Server Not Showing Content

If the development server is running but you're seeing a blank page or errors, follow these steps:

### 1. Verify the Server is Running

```bash
# Check if the server is running on port 8080
lsof -ti:8080

# Or check the process
ps aux | grep vite
```

### 2. Check the Correct URL

The development server should be accessible at:

- **http://localhost:8080** (most common)
- **http://127.0.0.1:8080** (IPv4 fallback)
- **http://[::1]:8080** (IPv6, if your system prefers it)

**Try all three URLs** if one doesn't work.

### 3. Check Browser Console

Open your browser's Developer Tools (F12 or Cmd+Option+I on Mac) and check:

1. **Console tab**: Look for JavaScript errors (red text)
2. **Network tab**: Check if files are loading (look for 404 errors)
3. **Elements tab**: Verify the `<div id="root"></div>` exists

### 4. Common Issues and Solutions

#### Blank White Page

**Possible causes:**
- JavaScript error preventing React from rendering
- Content Security Policy blocking resources
- Missing dependencies

**Solutions:**
```bash
# Clear browser cache and hard refresh
# Chrome/Edge: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
# Firefox: Ctrl+F5 (Windows) or Cmd+Shift+R (Mac)

# Clear Vite cache and restart
rm -rf node_modules/.vite
npm run dev
```

#### "Cannot GET /" or 404 Errors

**Solution:**
- Make sure you're accessing the root URL: `http://localhost:8080/`
- Don't add paths like `/index.html` or `/src/`

#### CORS or Network Errors

**Solution:**
- The server should be accessible on localhost without CORS issues
- If you see CORS errors, check the `vite.config.ts` server configuration

#### Port Already in Use

**Error:** `Port 8080 is already in use`

**Solution:**
```bash
# Kill the process using port 8080
lsof -ti:8080 | xargs kill -9

# Or change the port in vite.config.ts
# Edit server.port to a different value (e.g., 3000, 5173)
```

### 5. Verify Installation

If nothing works, verify your installation:

```bash
# Check Node.js version (should be 18+)
node --version

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Verify build works
npm run build
```

### 6. Check for TypeScript/ESLint Errors

Even if the server runs, code errors can prevent rendering:

```bash
# Check for TypeScript errors
npx tsc --noEmit

# Check for linting errors
npx eslint .
```

### 7. Browser-Specific Issues

#### Chrome/Edge
- Disable extensions that might interfere
- Try incognito/private mode
- Check if "Block third-party cookies" is affecting localhost

#### Firefox
- Disable privacy extensions
- Check if Enhanced Tracking Protection is blocking resources

#### Safari
- Enable "Develop" menu: Preferences → Advanced → "Show Develop menu"
- Disable "Prevent cross-site tracking" for localhost

### 8. Check Server Logs

Look at the terminal where `npm run dev` is running. You should see:

```
  VITE v6.x.x  ready in xxx ms

  ➜  Local:   http://localhost:8080/
  ➜  Network: use --host to expose
```

If you see errors in the terminal, those will help identify the issue.

### 9. Verify File Structure

Make sure these files exist:
- `index.html` (root)
- `src/main.tsx`
- `src/App.tsx`
- `src/index.css`

### 10. Test with a Simple Change

Try making a small change to verify hot reload works:

1. Edit `src/pages/Index.tsx`
2. Change some text
3. Save the file
4. Check if the browser updates automatically

If hot reload doesn't work, there might be a connection issue between the browser and Vite.

## "Couldn't save right now" / Settings Not Syncing

Before the web app saves an entry or publishes settings, it re-reads the
current version from your **read relays** and only writes if a strict majority
of them answer in time (see `src/lib/relayQuery.ts`). This stops one browser or
device from silently replacing writing, deletions, or privacy settings made on
another one.

**The trade-off:** if half or more of your read relays are down, very slow, or
require authentication, the app cannot confirm what is already stored, so it
refuses to write. Examples: 1 dead relay out of 2, or 2 out of 4. One dead
relay out of the five defaults is fine.

When a write is blocked, nothing is lost:

- **Entries:** the editor stays open with your notes intact and shows
  "Couldn't save right now". Save again once relays respond.
- **Settings** (privacy default, celebrated milestones, notification
  read-state): the change is kept on this device and is published with the
  next settings write that succeeds. A changed privacy default shows a
  one-time "Privacy default saved on this device" notice.

Showing settings is not held to the same rule: the app displays whatever
settings it could fetch, plus what is cached on the device.

**If saves are blocked repeatedly:** check your connection, then review your
relay list and remove or replace relays that no longer respond.

## Still Having Issues?

1. **Check the browser console** - This is the most important step
2. **Check the terminal** where `npm run dev` is running
3. **Try a different browser** to rule out browser-specific issues
4. **Try a different port** by modifying `vite.config.ts`
5. **Check firewall settings** - Make sure localhost connections aren't blocked

## Getting Help

When asking for help, provide:
- Browser and version
- Operating system
- Node.js version (`node --version`)
- Error messages from browser console
- Error messages from terminal
- Screenshot of what you see

---

For more setup information, see [LOCAL_SETUP.md](./LOCAL_SETUP.md).

