// file: src/utils/rateLimiter.js
// Verhindert unerwartete Kosten durch zu viele Anfragen

const RATE_LIMIT_CONFIG = {
  MAX_BANDWIDTH_PER_DAY_MB: 500, // 500MB pro Tag (Alert bei Überschreitung)
  MAX_SESSIONS_PER_HOUR: 1000, // Max 1000 Sessions/Stunde
  MAX_CSV_EXPORTS_PER_HOUR: 100, // Max 100 CSV-Exporte/Stunde
  STORAGE_QUOTA_MB: 8, // localStorage Limit warnen bei 8MB
};

class RateLimiter {
  constructor() {
    this.requestLog = this.loadLog();
    this.setupCleanup();
  }

  loadLog() {
    try {
      const log = localStorage.getItem('_rateLimitLog');
      return log ? JSON.parse(log) : {};
    } catch {
      return {};
    }
  }

  saveLog() {
    try {
      localStorage.setItem('_rateLimitLog', JSON.stringify(this.requestLog));
    } catch (e) {
      console.warn('RateLimit Log konnte nicht gespeichert werden:', e);
    }
  }

  setupCleanup() {
    // Logs älter als 24h löschen
    setInterval(() => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      
      Object.keys(this.requestLog).forEach(key => {
        if (parseInt(key) < oneDayAgo) {
          delete this.requestLog[key];
        }
      });
      
      this.saveLog();
    }, 60 * 60 * 1000); // Stündlich
  }

  logRequest(type = 'page_load') {
    const now = Date.now();
    const dayKey = Math.floor(now / (24 * 60 * 60 * 1000));
    const hourKey = Math.floor(now / (60 * 60 * 1000));

    if (!this.requestLog[dayKey]) this.requestLog[dayKey] = {};
    if (!this.requestLog[dayKey][type]) this.requestLog[dayKey][type] = 0;
    
    this.requestLog[dayKey][type]++;
    this.saveLog();

    return this.checkLimits(dayKey, type);
  }

  checkLimits(dayKey, type) {
    const dailyCount = this.requestLog[dayKey]?.[type] || 0;
    const warnings = [];

    switch(type) {
      case 'page_load':
        if (dailyCount > RATE_LIMIT_CONFIG.MAX_SESSIONS_PER_HOUR * 24) {
          warnings.push('⚠️ Zu viele Seitenaufrufe. Service wird begrenzt.');
          return { blocked: true, reason: 'Rate limit exceeded' };
        }
        break;

      case 'csv_export':
        if (dailyCount > RATE_LIMIT_CONFIG.MAX_CSV_EXPORTS_PER_HOUR * 24) {
          warnings.push('⚠️ Zu viele CSV-Exporte. Bitte morgen wieder versuchen.');
          return { blocked: true, reason: 'CSV export limit exceeded' };
        }
        break;
    }

    if (warnings.length > 0) {
      console.warn(warnings.join('\n'));
    }

    return { blocked: false, warnings };
  }

  checkStorageQuota() {
    try {
      const testKey = '_storageTest_' + Date.now();
      const testData = 'x'.repeat(1024 * 1024); // 1MB test data
      localStorage.setItem(testKey, testData);
      localStorage.removeItem(testKey);

      // Geschätzter Speicher (sehr grob)
      let estimatedMB = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          estimatedMB += (localStorage[key].length / 1024 / 1024);
        }
      }

      if (estimatedMB > RATE_LIMIT_CONFIG.STORAGE_QUOTA_MB) {
        return {
          warning: `⚠️ Speicher fast voll: ${estimatedMB.toFixed(2)}MB / ${RATE_LIMIT_CONFIG.STORAGE_QUOTA_MB}MB`,
          blocked: false,
        };
      }

      return { warning: null, blocked: false, usedMB: estimatedMB };
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        return {
          warning: '❌ Speicher voll! Alte Daten löschen.',
          blocked: true,
          reason: 'Storage quota exceeded',
        };
      }
      return { warning: null, blocked: false };
    }
  }

  // Automatisch Alte Sessions löschen wenn Speicher kritisch
  autoCleanupOldSessions() {
    const sessions = JSON.parse(localStorage.getItem('workSessions') || '[]');
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const filtered = sessions.filter(s => s.start > thirtyDaysAgo);
    const deleted = sessions.length - filtered.length;

    if (deleted > 0) {
      localStorage.setItem('workSessions', JSON.stringify(filtered));
      console.log(`🧹 ${deleted} alte Sessions gelöscht (>30 Tage)`);
    }

    return deleted;
  }
}

export const rateLimiter = new RateLimiter();

// Exports für App.jsx
export function checkStorageAndWarn() {
  const quota = rateLimiter.checkStorageQuota();
  if (quota.warning) {
    console.warn(quota.warning);
  }
  if (quota.blocked) {
    rateLimiter.autoCleanupOldSessions();
  }
  return quota;
}

export function logPageLoad() {
  return rateLimiter.logRequest('page_load');
}

export function logCSVExport() {
  return rateLimiter.logRequest('csv_export');
}
