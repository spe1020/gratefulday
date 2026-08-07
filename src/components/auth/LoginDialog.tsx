// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import React, { useRef, useState, useEffect } from 'react';
import { Shield, Upload, AlertTriangle, UserPlus, KeyRound, Sparkles, Cloud, Smartphone, Loader2 } from 'lucide-react';
import { useNostr } from '@nostrify/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLoginActions } from '@/hooks/useLoginActions';
import { startNostrConnect, type NostrConnectSession } from '@/lib/nostrConnect';
import { cn } from '@/lib/utils';

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  onSignup?: () => void;
}

const validateNsec = (nsec: string) => {
  // Strict bech32 charset: lowercase only, and no b/i/o/1 in the data part.
  return /^nsec1[02-9ac-hj-np-z]{58}$/.test(nsec);
};

const validateBunkerUri = (uri: string) => {
  return uri.startsWith('bunker://');
};

/** Section wrapper so every login method reads as one card in a single list. */
const MethodSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <div className='rounded-xl border bg-muted/40 p-4 space-y-3'>
    <div className='flex items-center gap-2 font-medium text-sm'>
      {icon}
      <span>{title}</span>
    </div>
    {children}
  </div>
);

const LoginDialog: React.FC<LoginDialogProps> = ({ isOpen, onClose, onLogin, onSignup }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [nsec, setNsec] = useState('');
  const [bunkerUri, setBunkerUri] = useState('');
  const [amberSession, setAmberSession] = useState<NostrConnectSession | null>(null);
  const [errors, setErrors] = useState<{
    nsec?: string;
    bunker?: string;
    file?: string;
    extension?: string;
    amber?: string;
  }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const login = useLoginActions();
  const { nostr } = useNostr();

  // Reset all state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      // Reset state when dialog opens
      setIsLoading(false);
      setIsFileLoading(false);
      setNsec('');
      setBunkerUri('');
      setErrors({});
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [isOpen]);

  // Stop listening for a signer approval whenever the dialog goes away.
  useEffect(() => {
    if (!isOpen && amberSession) {
      amberSession.cancel();
      setAmberSession(null);
    }
  }, [isOpen, amberSession]);

  // Don't keep secrets in React state after the dialog closes (e.g. after a
  // successful login) — clear them on close.
  useEffect(() => {
    if (!isOpen) {
      setNsec('');
      setBunkerUri('');
    }
  }, [isOpen]);

  const handleAmberStart = () => {
    setErrors(prev => ({ ...prev, amber: undefined }));
    const session = startNostrConnect(nostr, {
      name: 'gratefulday.space',
      url: 'https://gratefulday.space',
    });
    setAmberSession(session);

    // Hand off to Amber in THIS click. startNostrConnect is synchronous, so the
    // URI is ready now — and mobile browsers only allow navigating to a custom
    // scheme from a real user gesture, so deferring it to an effect or a
    // promise callback would get it blocked.
    window.location.href = session.uri;

    session.established
      .then((loginObj) => {
        login.remote(loginObj);
        setAmberSession(null);
        onLogin();
        onClose();
      })
      .catch((e: unknown) => {
        // Cancellation (dialog closed / retry) is not an error worth showing.
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.error('Amber login failed:', e);
        setAmberSession(null);
        setErrors(prev => ({
          ...prev,
          amber: 'Could not complete the Amber connection. Please try again.',
        }));
      });
  };

  const handleExtensionLogin = async () => {
    setIsLoading(true);
    setErrors(prev => ({ ...prev, extension: undefined }));

    try {
      if (!('nostr' in window)) {
        throw new Error('Nostr extension not found. Please install a NIP-07 extension.');
      }
      await login.extension();
      onLogin();
      onClose();
    } catch (e: unknown) {
      console.error('Extension login failed:', e);
      // Don't surface raw extension error messages — show our own copy.
      const notFound = e instanceof Error && e.message.startsWith('Nostr extension not found');
      setErrors(prev => ({
        ...prev,
        extension: notFound
          ? e.message
          : 'Extension login failed. Please approve the request in your extension and try again.'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const executeLogin = (key: string) => {
    setIsLoading(true);
    setErrors({});

    // Use a timeout to allow the UI to update before the synchronous login call
    setTimeout(() => {
      try {
        login.nsec(key);
        onLogin();
        onClose();
      } catch {
        setErrors({ nsec: "Failed to login with this key. Please check that it's correct." });
        setIsLoading(false);
      }
    }, 50);
  };

  const handleKeyLogin = () => {
    if (!nsec.trim()) {
      setErrors(prev => ({ ...prev, nsec: 'Please enter your secret key' }));
      return;
    }

    if (!validateNsec(nsec)) {
      setErrors(prev => ({ ...prev, nsec: 'Invalid secret key format. Must be a valid nsec starting with nsec1.' }));
      return;
    }
    executeLogin(nsec);
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUri.trim()) {
      setErrors(prev => ({ ...prev, bunker: 'Please enter a bunker URI' }));
      return;
    }

    if (!validateBunkerUri(bunkerUri)) {
      setErrors(prev => ({ ...prev, bunker: 'Invalid bunker URI format. Must start with bunker://' }));
      return;
    }

    setIsLoading(true);
    setErrors(prev => ({ ...prev, bunker: undefined }));

    try {
      await login.bunker(bunkerUri);
      onLogin();
      onClose();
      // Clear the URI from memory
      setBunkerUri('');
    } catch {
      setErrors(prev => ({
        ...prev,
        bunker: 'Failed to connect to bunker. Please check the URI.'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsFileLoading(true);
    setErrors({});

    const reader = new FileReader();
    reader.onload = (event) => {
      setIsFileLoading(false);
      const content = event.target?.result as string;
      if (content) {
        const trimmedContent = content.trim();
        if (validateNsec(trimmedContent)) {
          executeLogin(trimmedContent);
        } else {
          setErrors({ file: 'File does not contain a valid secret key.' });
        }
      } else {
        setErrors({ file: 'Could not read file content.' });
      }
    };
    reader.onerror = () => {
      setIsFileLoading(false);
      setErrors({ file: 'Failed to read file.' });
    };
    reader.readAsText(file);
  };

  const handleSignupClick = () => {
    onClose();
    if (onSignup) {
      onSignup();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn("max-w-[95vw] sm:max-w-md p-0 overflow-hidden rounded-2xl flex flex-col")}
      >
        <DialogHeader className={cn('px-6 pt-6 pb-1 relative')}>

            <DialogDescription className="text-center">
              Sign up or log in to continue
            </DialogDescription>
        </DialogHeader>
        <div className='px-6 pt-2 pb-4 space-y-4 overflow-y-auto flex-1 min-h-0'>
          {/* Prominent Sign Up Section */}
          <div className='relative p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-950/50 dark:to-indigo-950/50 border border-blue-200 dark:border-blue-800 overflow-hidden'>
            <div className='relative z-10 text-center space-y-3'>
              <div className='flex justify-center items-center gap-2 mb-2'>
                <Sparkles className='w-5 h-5 text-blue-600' />
                <span className='font-semibold text-blue-800 dark:text-blue-200'>
                  New to Nostr?
                </span>
              </div>
              <p className='text-sm text-blue-700 dark:text-blue-300'>
                Create a new account to get started. It's free and open.
              </p>
              <Button
                onClick={handleSignupClick}
                className='w-full rounded-full py-3 text-base font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transform transition-all duration-200 hover:scale-105 shadow-lg border-0'
              >
                <UserPlus className='w-4 h-4 mr-2' />
                <span>Sign Up</span>
              </Button>
            </div>
          </div>

          {/* Divider */}
          <div className='relative'>
            <div className='absolute inset-0 flex items-center'>
              <div className='w-full border-t border-gray-300 dark:border-gray-600'></div>
            </div>
            <div className='relative flex justify-center text-sm'>
              <span className='px-3 bg-background text-muted-foreground'>
                <span>Or log in</span>
              </span>
            </div>
          </div>

          {/* All login methods, visible at once */}

          {/* Amber (NIP-46 via nostrconnect://) */}
          <MethodSection
            icon={<Smartphone className='w-4 h-4 text-orange-500' />}
            title='Amber (Android signer)'
          >
            {errors.amber && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{errors.amber}</AlertDescription>
              </Alert>
            )}
            {!amberSession ? (
              <>
                <p className='text-sm text-muted-foreground'>
                  Keep your key in the Amber app and approve everything there — one prompt covers all permissions.
                </p>
                <Button
                  className='w-full rounded-full bg-orange-500 hover:bg-orange-600 text-white'
                  onClick={handleAmberStart}
                >
                  Connect with Amber
                </Button>
              </>
            ) : (
              <div className='space-y-2'>
                <p className='flex items-center justify-center gap-2 text-sm text-muted-foreground'>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  Waiting for approval in Amber…
                </p>
                {/* Retry of the same hand-off, for when the deep link doesn't
                    fire (Amber not installed, or a browser that swallowed it). */}
                <button
                  type='button'
                  onClick={() => { window.location.href = amberSession.uri; }}
                  className='w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
                >
                  Didn't open? Tap to try again
                </button>
              </div>
            )}
          </MethodSection>

          {/* Browser extension */}
          <MethodSection
            icon={<Shield className='w-4 h-4 text-primary' />}
            title='Browser extension'
          >
            {errors.extension && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{errors.extension}</AlertDescription>
              </Alert>
            )}
            <p className='text-sm text-muted-foreground'>
              Login with one click using a NIP-07 browser extension
            </p>
            <Button
              className='w-full rounded-full'
              onClick={handleExtensionLogin}
              disabled={isLoading}
            >
              {isLoading ? 'Logging in...' : 'Login with Extension'}
            </Button>
          </MethodSection>

          {/* Bunker URI */}
          <MethodSection
            icon={<Cloud className='w-4 h-4 text-primary' />}
            title='Bunker (remote signer)'
          >
            <div className='space-y-2'>
              <Input
                id='bunkerUri'
                value={bunkerUri}
                onChange={(e) => {
                  setBunkerUri(e.target.value);
                  if (errors.bunker) setErrors(prev => ({ ...prev, bunker: undefined }));
                }}
                className={`rounded-lg ${errors.bunker ? 'border-red-500' : ''}`}
                placeholder='bunker://'
                autoComplete="off"
              />
              {errors.bunker && (
                <p className="text-sm text-red-500">{errors.bunker}</p>
              )}
            </div>
            <Button
              className='w-full rounded-full'
              onClick={handleBunkerLogin}
              disabled={isLoading || !bunkerUri.trim()}
            >
              {isLoading ? 'Connecting...' : 'Login with Bunker'}
            </Button>
          </MethodSection>

          {/* Secret key */}
          <MethodSection
            icon={<KeyRound className='w-4 h-4 text-primary' />}
            title='Secret key (nsec)'
          >
            <div className='space-y-2'>
              <Input
                id='nsec'
                type="password"
                value={nsec}
                onChange={(e) => {
                  setNsec(e.target.value);
                  if (errors.nsec) setErrors(prev => ({ ...prev, nsec: undefined }));
                }}
                className={`rounded-lg ${
                  errors.nsec ? 'border-red-500 focus-visible:ring-red-500' : ''
                }`}
                placeholder='nsec1...'
                autoComplete="off"
              />
              {errors.nsec && (
                <p className="text-sm text-red-500">{errors.nsec}</p>
              )}
            </div>
            <Button
              className='w-full rounded-full'
              onClick={handleKeyLogin}
              disabled={isLoading || !nsec.trim()}
            >
              {isLoading ? 'Verifying...' : 'Log In'}
            </Button>
            <input
              type='file'
              accept='.txt'
              className='hidden'
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <Button
              variant='outline'
              className='w-full'
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isFileLoading}
            >
              <Upload className='w-4 h-4 mr-2' />
              {isFileLoading ? 'Reading File...' : 'Upload Your Key File'}
            </Button>
            {errors.file && (
              <p className="text-sm text-red-500 mt-2">{errors.file}</p>
            )}
          </MethodSection>
        </div>
      </DialogContent>
    </Dialog>
    );
  };

export default LoginDialog;
