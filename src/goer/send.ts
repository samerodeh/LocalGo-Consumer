import { authenticatedGoerEnabled, runAuthenticatedGoerTurn } from './authenticatedClient';
import { goerMsg, goerOwnerGeneration, useGoerStore } from './goerStore';
import { isCheckoutChatCommand, runCheckoutChatCommand } from './checkoutChat';

/**
 * Single entry point for user input from the chat UI (typed text and
 * quick-reply taps). Routes the turn to the streaming LLM loop or the local
 * fallback NLU depending on the store's mode.
 */
export async function sendGoerMessage(rawText: string, retryPending = false): Promise<void> {
  const text = rawText.trim();
  const store = useGoerStore.getState();
  if (!text || store.isStreaming || store.isHistoryLoading) return;
  if (authenticatedGoerEnabled && store.pendingMessage && (!retryPending || store.pendingMessage !== text)) return;
  const generation = goerOwnerGeneration();

  if (!retryPending) {
    store.appendMessage(goerMsg({ kind: 'text', role: 'user', text }));
    store.appendApiMessage({ role: 'user', content: text });
  }
  store.setStreaming(true);

  try {
    if (authenticatedGoerEnabled) {
      await runAuthenticatedGoerTurn(text, isCheckoutChatCommand(text)
        ? () => runCheckoutChatCommand(text) : undefined);
    } else if (store.mode === 'llm') {
      const { runGoerTurn } = await import('./agentLoop');
      await runGoerTurn(text);
    } else {
      const { runFallbackTurn } = await import('./localNLU');
      await runFallbackTurn(text);
    }
  } catch (err) {
    if (generation !== goerOwnerGeneration()) return;
    console.warn('[goer] turn failed:', err);
    useGoerStore
      .getState()
      .appendMessage(
        goerMsg({
          kind: 'system_note',
          text: authenticatedGoerEnabled && err instanceof Error ? err.message
            : 'Something went wrong on my end — mind trying that again?',
        }),
      );
  } finally {
    if (generation === goerOwnerGeneration()) useGoerStore.getState().setStreaming(false);
  }
}
