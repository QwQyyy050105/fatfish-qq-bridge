const unavailable = () => Object.freeze({ characterId: 'fatfish', runtimeImplemented: false, available: false, ready: false, paused: true, reason: 'tts_adapter_not_configured', fallback: 'text', blockers: ['tts_adapter_not_configured'] });
const fail = () => { throw Object.assign(new Error('tts_adapter_not_configured'), { code: 'tts_adapter_not_configured' }); };
export const readFatfishSharedRuntimeStatus = unavailable;
export const assertFatfishSharedVoiceReady = fail;
export const generateFatfishSharedVoice = fail;
export const verifyFatfishGeneratedAudio = fail;
export const createFatfishSharedVoiceClient = () => ({ status: unavailable, assertReady: fail, generate: fail });
