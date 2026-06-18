import vscode from 'vscode';
import { SecretsManager } from './SecretsManager';
import { OpenRouterClient } from './OpenRouterClient';
import { ModelRegistry } from './ModelRegistry';
import { SessionTracker } from './SessionTracker';
import { ChatProvider } from './ChatProvider';
import { ModelConfig } from './types';

export class AuthError extends Error {
  constructor(public readonly reason: 'no-key' | 'invalid-key') {
    super(reason === 'no-key' ? 'No API key configured.' : 'API key rejected (401 Unauthorized).');
    this.name = 'AuthError';
  }
}

export interface RegistrationResult extends vscode.Disposable {
  readonly tracker: SessionTracker;
}

export async function registerAll(
  context: vscode.ExtensionContext,
  secrets: SecretsManager,
): Promise<RegistrationResult> {
  const cfg = vscode.workspace.getConfiguration('orcp');
  const baseUrl: string = cfg.get('baseUrl', 'https://openrouter.ai/api/v1');
  const modelConfigs: Record<string, ModelConfig> = cfg.get('models', {});

  const client = new OpenRouterClient(secrets, baseUrl);
  const registry = new ModelRegistry();
  const tracker = new SessionTracker();
  const provider = new ChatProvider(registry, client, tracker);

  try {
    const rawModels = await client.listModels();
    registry.rebuild(rawModels, modelConfigs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNoKey = msg.includes('API key');
    const isUnauthorized =
      (err instanceof Error && err.constructor.name.includes('Unauthorized')) ||
      msg.includes('401') ||
      msg.includes('Unauthorized');

    if (isNoKey) {
      throw new AuthError('no-key');
    } else if (isUnauthorized) {
      throw new AuthError('invalid-key');
    } else {
      vscode.window.showErrorMessage(`ORCP: Failed to load models. ${String(err)}`);
    }
  }

  const providerDisposable = vscode.lm.registerLanguageModelChatProvider(
    'ostash.openrouter',
    provider,
  );

  return {
    tracker,
    dispose() {
      providerDisposable.dispose();
      registry.dispose();
      tracker.dispose();
    },
  };
}
