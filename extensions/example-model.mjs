// Enable in template.config.json: plugins:["./extensions/example-model.mjs"], model.adapter:"example-echo".
export default {
  apiVersion: 1, id: 'example-echo', capabilities: ['model:text'],
  async setup(context) {
    context.log?.({ event: 'plugin_loaded', id: 'example-echo' });
    return { dependencies: [], providers: { models: { 'example-echo': () => ({ capabilities: { text: true, tools: false, vision: false, asr: false, tts: false }, complete: async messages => ({ text: `离线示例收到：${messages.at(-1).content.slice(-100)}` }) }) } } };
  }
};
