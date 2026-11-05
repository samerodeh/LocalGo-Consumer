import { serverCartEnabled } from '../lib/serverCart';
import { buildGoerContext } from './context';
import { executeTool } from './tools/executors';
import { goerMsg, useGoerStore } from './goerStore';
import { runFallbackTurn } from './localNLU';
import { streamGoerChat } from './streamClient';
import { isGoerAgentId, type GoerAction, type GoerAgentId, type GoerStreamEvent } from './types';

/**
 * Runs one user turn against the backend's multi-agent pipeline.
 *
 * The backend does the thinking — guard, routing, retrieval, prompt assembly,
 * and the reply — and answers with the specialist who took the turn, the reply
 * tokens, and the tool calls it wants applied. This function's job is the part
 * that can only happen on the device: swapping the visible agent, streaming the
 * text into the bubble, and executing those calls against the zustand stores.
 *
 * On transport failure it downgrades — visibly but gracefully — to the offline
 * rule-based assistant and replays the same user input.
 */
export async function runGoerTurn(userText: string): Promise<void> {
  const startingAgent = useGoerStore.getState().activeAgent;

  let agent: GoerAgentId = startingAgent;
  let text = '';
  let actions: GoerAction[] = [];
  let quickReplies: string[] = [];
  let streamError: string | null = null;

  const handleEvent = (event: GoerStreamEvent) => {
    switch (event.type) {
      case 'agent':
        if (isGoerAgentId(event.agent)) {
          agent = event.agent;
          // Swap before the text lands so the divider and the typing indicator
          // name the specialist who is actually answering.
          useGoerStore.getState().setActiveAgent(agent, true);
        }
        break;
      case 'token':
        text += event.token;
        useGoerStore.getState().setStreamingText(text);
        break;
      case 'actions':
        actions = event.actions ?? [];
        break;
      case 'quick_replies':
        quickReplies = event.options ?? [];
        break;
      case 'error':
        streamError = event.error?.message ?? 'stream error';
        break;
      default:
        break; // 'done' needs no handling — the stream closing is the signal.
    }
  };

  // One transparent retry, but only if nothing streamed to the UI yet.
  for (let attempt = 0; attempt < 2; attempt++) {
    text = '';
    actions = [];
    quickReplies = [];
    streamError = null;
    useGoerStore.getState().setStreamingText('');

    try {
      await streamGoerChat(
        {
          message: userText,
          history: useGoerStore.getState().apiMessages,
          activeAgent: startingAgent,
          context: buildGoerContext(),
          userId: useGoerStore.getState().ownerEmail ?? 'guest',
        },
        handleEvent,
      );
      if (streamError) throw new Error(streamError);
      break;
    } catch (err) {
      console.warn(`[goer] stream attempt ${attempt + 1} failed:`, err);
      const streamed = text.length > 0;
      if (attempt === 1 || streamed) {
        if (serverCartEnabled) throw new Error('Connection interrupted. Check the server cart before retrying; offline replay is disabled.');
        // Downgrade for the rest of the session; the fallback NLU answers this
        // same input so the user never hits a dead end.
        const store = useGoerStore.getState();
        store.setStreamingText('');
        store.setMode('fallback');
        store.appendMessage(
          goerMsg({ kind: 'system_note', text: 'Connection hiccup — switched to the offline assistant.' }),
        );
        await runFallbackTurn(userText);
        return;
      }
    }
  }

  // Finalize the streamed text into a real bubble.
  const store = useGoerStore.getState();
  store.setStreamingText('');
  if (text.trim().length > 0) {
    store.appendMessage(goerMsg({ kind: 'text', role: 'assistant', agent, text: text.trim() }));
    store.appendApiMessage({ role: 'assistant', content: text.trim() });
  }

  // Apply the backend's tool calls. They run after the text because the reply
  // was written knowing their outcome, so the cards belong underneath it.
  for (const call of actions) {
    if (!call || typeof call.tool !== 'string') continue;
    const execution = await executeTool(call.tool, call.input ?? {});
    for (const widget of execution.widgets ?? []) {
      useGoerStore.getState().appendMessage({ ...widget, agent });
    }
    if (execution.isError) {
      // The agent already spoke, so surface what actually went wrong rather
      // than leaving the user with a reply that describes something that
      // didn't happen (an ambiguous item name is the common case).
      console.warn(`[goer] action ${call.tool} failed:`, execution.resultText);
      useGoerStore
        .getState()
        .appendMessage(goerMsg({ kind: 'system_note', agent, text: execution.resultText }));
      useGoerStore
        .getState()
        .appendApiMessage({ role: 'user', content: `[app] ${call.tool}: ${execution.resultText}` });
    }
  }

  if (quickReplies.length > 0) {
    useGoerStore.getState().appendMessage(goerMsg({ kind: 'quick_replies', agent, options: quickReplies }));
  }
}
