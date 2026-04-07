import type { AgentStrategy, StrategyName } from '../types.js';
import { TwoTurnStrategy } from './two-turn.strategy.js';
import { MultiTurnReflectionStrategy } from './multi-turn-reflection.strategy.js';

const strategies: Record<StrategyName, () => AgentStrategy> = {
    'two-turn': () => new TwoTurnStrategy(),
    'multi-turn-reflection': () => new MultiTurnReflectionStrategy(),
};

/**
 * Get the configured agent strategy.
 * Reads AGENT_STRATEGY from env (default: 'multi-turn-reflection').
 * Override by passing an explicit strategy name.
 */
export function getStrategy(override?: StrategyName): AgentStrategy {
    const name = override || (process.env.AGENT_STRATEGY as StrategyName) || 'multi-turn-reflection';
    const factory = strategies[name];
    if (!factory) {
        throw new Error(`Unknown agent strategy: ${name}. Valid options: ${Object.keys(strategies).join(', ')}`);
    }
    return factory();
}

export { TwoTurnStrategy } from './two-turn.strategy.js';
export { MultiTurnReflectionStrategy } from './multi-turn-reflection.strategy.js';
