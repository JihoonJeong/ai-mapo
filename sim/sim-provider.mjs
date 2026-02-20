/**
 * sim-provider.mjs — AI API 호출 (Anthropic / OpenAI / Ollama / Mock)
 *
 * advisor.js의 브라우저 호출 로직을 Node.js로 이식.
 * Node 18+ 내장 fetch 사용.
 */

/**
 * Provider 팩토리
 * @param {string} type - 'anthropic' | 'openai' | 'ollama' | 'mock'
 * @param {Object} config - { apiKey, model, ollamaUrl }
 * @returns {(messages: Array) => Promise<{content: string, usage: {input: number, output: number}}>}
 */
export function createProvider(type, config = {}) {
  switch (type) {
    case 'anthropic': return (msgs) => anthropicCall(msgs, config);
    case 'openai':    return (msgs) => openaiCall(msgs, config);
    case 'ollama':    return (msgs) => ollamaCall(msgs, config);
    case 'mock':      return (msgs) => mockCall(msgs);
    default: throw new Error(`Unknown provider: ${type}`);
  }
}

/** Default models per provider */
export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  ollama: 'llama3.1:8b',
  mock: 'mock',
};

// === Anthropic ===
async function anthropicCall(messages, config) {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');

  const model = config.model || DEFAULT_MODELS.anthropic;
  const systemMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system: systemMsg?.content || '',
      messages: otherMsgs,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic error ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.content[0].text,
    usage: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
  };
}

// === OpenAI ===
async function openaiCall(messages, config) {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required');

  const model = config.model || DEFAULT_MODELS.openai;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI error ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    usage: {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0,
    },
  };
}

// === Ollama ===
async function ollamaCall(messages, config) {
  const ollamaUrl = config.ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = config.model || DEFAULT_MODELS.ollama;

  const systemMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemMsg?.content || '' },
        ...otherMsgs,
      ],
      stream: false,
    }),
  });

  if (!response.ok) throw new Error(`Ollama error ${response.status}`);
  const data = await response.json();
  return {
    content: data.message?.content || '',
    usage: {
      input: data.prompt_eval_count || 0,
      output: data.eval_count || 0,
    },
  };
}

// === Mock ===
async function mockCall(_messages) {
  const budget = { economy: 15, transport: 15, culture: 10, environment: 15, education: 15, welfare: 15, renewal: 15 };
  const action = {
    reasoning: 'Mock provider: 균등 예산 배분, 정책 변경 없음.',
    budget,
    policies: { activate: [], deactivate: [] },
    eventChoice: null,
  };
  return {
    content: JSON.stringify(action),
    usage: { input: 0, output: 0 },
  };
}
