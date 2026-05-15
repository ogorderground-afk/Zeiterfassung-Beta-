const RATE_LIMIT_CONFIG = {
  MAX_BANDWIDTH_PER_DAY_MB: 500,
  MAX_SESSIONS_PER_HOUR: 1000,
  MAX_CSV_EXPORTS_PER_HOUR: 100,
  STORAGE_QUOTA_MB: 8,
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
    setInterval(() => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      
      Object.keys(this.requestLog).forEach(key => {
        if (parseInt(key) < oneDayAgo) {
          delete this.requestLog[key];
        }
      });
      
      this.saveLog();
    }, 60 * 60 * 1000);
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

  async checkStorageQuota() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usedMB = (est.usage || 0) / 1024 / 1024;
        const quotaMB = (est.quota || 0) / 1024 / 1024;
        if (quotaMB > 0 && usedMB / quotaMB > 0.8) {
          return { warning: `⚠️ Speicher fast voll: ${usedMB.toFixed(0)}MB / ${quotaMB.toFixed(0)}MB`, blocked: false };
        }
        return { warning: null, blocked: false, usedMB };
      } catch { return { warning: null, blocked: false }; }
    }
    return { warning: null, blocked: false };
  }

  autoCleanupOldSessions() {
    // handled by IndexedDB; localStorage no longer used for sessions
    return 0;
  }
}

export const rateLimiter = new RateLimiter();

export async function checkStorageAndWarn() {
  const quota = await rateLimiter.checkStorageQuota();
  if (quota.warning) { console.warn(quota.warning); }
  return quota;
}

export function logPageLoad() {
  return rateLimiter.logRequest('page_load');
}

export function logCSVExport() {
  return rateLimiter.logRequest('csv_export');
}
