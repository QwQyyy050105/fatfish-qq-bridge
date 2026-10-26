const status = () => Object.freeze({ characterId: 'fatfish', mode: 'on_demand', fallback: 'text', generationImplemented: false, available: false, ready: false, paused: true, phase: 'readiness_only', reason: 'tts_adapter_not_configured', selectionStatus: 'unknown', transportSupported: false, profileHash: null });
export const createSharedVoiceStatusReader = () => status;
export const readFatfishVoiceStatus = status;
