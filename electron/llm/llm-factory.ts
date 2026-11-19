import { ILLMProvider } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import { OpenAIProvider } from './openai-provider'
import { GeminiProvider } from './gemini-provider'
import { AnthropicProvider } from './anthropic-provider'
import { CliHarnessProvider } from './cli-harness-provider'

export class LLMFactory {
  static getProvider(model: ModelProfile): ILLMProvider {
    if (model.protocol === 'cli') {
      return new CliHarnessProvider()
    }
    if (model.protocol === 'gemini') {
      return new GeminiProvider()
    }
    if (model.protocol === 'anthropic') {
      return new AnthropicProvider()
    }
    return new OpenAIProvider()
  }
}
