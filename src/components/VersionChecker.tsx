// src/components/VersionChecker.tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds

export default function VersionChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialBuildId = useRef<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const { buildId } = await res.json();

      if (initialBuildId.current === null) {
        // First check: store the current build ID
        initialBuildId.current = buildId;
      } else if (buildId !== initialBuildId.current) {
        // Build ID changed → new deployment detected
        setUpdateAvailable(true);
        // Stop polling once we detect an update
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch {
      // Network errors are silently ignored (offline, etc.)
    }
  }, []);

  useEffect(() => {
    // Initial check
    checkVersion();

    // Periodic polling
    intervalRef.current = setInterval(checkVersion, CHECK_INTERVAL_MS);

    // Also check when the tab regains focus (common on mobile)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkVersion]);

  const handleUpdate = () => {
    // Hard reload: bypasses browser cache completely
    window.location.reload();
  };

  if (!updateAvailable) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        maxWidth: 'calc(100vw - 32px)',
        width: 420,
        animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 20px',
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1) inset',
          color: 'white',
        }}
      >
        {/* Animated icon */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          animation: 'pulse-glow 2s ease-in-out infinite',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>

        {/* Message */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
            Nueva versión disponible
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.3 }}>
            Actualiza para obtener mejoras
          </p>
        </div>

        {/* Update button */}
        <button
          onClick={handleUpdate}
          style={{
            padding: '8px 16px',
            borderRadius: 10,
            border: 'none',
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
            color: 'white',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          onMouseOver={e => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 4px 15px rgba(59,130,246,0.4)';
          }}
          onMouseOut={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          Actualizar
        </button>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(30px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); }
          50% { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
        }
      `}</style>
    </div>
  );
}
