/**
 * ServiceRegistry - Centralized service management for SPO Gateway
 *
 * Provides:
 * - Centralized service registration and retrieval
 * - Ordered initialization with dependency management
 * - Health checks for monitoring
 * - Graceful shutdown handling
 */

import { EventEmitter } from 'events';

/**
 * Service lifecycle interface
 * Services can optionally implement these methods for managed lifecycle
 */
/**
 * Callback for services to report sub-step progress during initialization.
 * @param subStep - User-friendly description (e.g. "Step 2/4: Scanning local cache")
 */
export type SubProgressCallback = (subStep: string) => void;

export interface Service {
  /** Service name for logging and identification */
  readonly name: string;

  /** Initialize the service (called during startup). Optional reportProgress for sub-step updates. */
  initialize?(reportProgress?: SubProgressCallback): Promise<void>;

  /** Shutdown the service gracefully */
  shutdown?(): Promise<void>;

  /** Health check - returns true if service is healthy */
  isHealthy?(): boolean;

  /** Get service statistics for monitoring (return type is flexible) */
  getStats?(): unknown;
}

/**
 * Service initialization status
 */
export type ServiceStatus = 'pending' | 'running' | 'complete' | 'failed';

/**
 * Per-service entry in a startup progress event
 */
export interface ServiceStatusEntry {
  name: string;
  status: ServiceStatus;
  progress: number;
  /** Optional sub-step description (e.g. "Step 2/4: Scanning local cache") */
  subStep?: string;
}

/**
 * Pre-service cache-building step entry
 */
export interface CacheStepEntry {
  name: string;
  label: string;
  status: 'pending' | 'running' | 'complete';
}

/**
 * Emitted on the registry EventEmitter as 'startup-progress'
 */
export interface StartupProgressEvent {
  phase: 'initializing' | 'ready';
  progress: number;   // 0–1
  message: string;
  services: ServiceStatusEntry[];
  /** Pre-service cache-building steps (present only during cache phase) */
  cacheSteps?: CacheStepEntry[];
}

/**
 * Service registration options
 */
export interface ServiceRegistration {
  /** The service instance */
  service: Service;

  /** Services that must be initialized before this one */
  dependsOn?: string[];

  /** Priority for shutdown order (higher = shutdown first) */
  shutdownPriority?: number;

  /**
   * Relative weight used to calculate overall startup progress (default 1).
   * Higher weight = this service represents a larger share of total work.
   */
  progressWeight?: number;

  /**
   * User-friendly message shown while this service is initializing.
   * E.g. "Downloading game assets..."
   */
  progressMessage?: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  services: Record<string, {
    healthy: boolean;
    stats?: unknown;
  }>;
  uptime: number;
}

/**
 * ServiceRegistry - Manages all singleton services
 */
export class ServiceRegistry extends EventEmitter {
  private services: Map<string, ServiceRegistration> = new Map();
  private initialized: boolean = false;
  private shuttingDown: boolean = false;
  private startTime: number = 0;

  /**
   * Register a service with the registry
   */
  register(name: string, service: Service, options?: Partial<ServiceRegistration>): void {
    if (this.initialized) {
      throw new Error(`Cannot register service '${name}' after initialization`);
    }

    if (this.services.has(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }

    this.services.set(name, {
      service,
      dependsOn: options?.dependsOn ?? [],
      shutdownPriority: options?.shutdownPriority ?? 0,
      progressWeight: options?.progressWeight ?? 1,
      progressMessage: options?.progressMessage,
    });
  }

  /**
   * Get a registered service by name
   */
  get<T extends Service>(name: string): T {
    const registration = this.services.get(name);
    if (!registration) {
      throw new Error(`Service '${name}' is not registered`);
    }
    return registration.service as T;
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Initialize all registered services in dependency order.
   * Services at the same dependency depth run in parallel via Promise.all.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('ServiceRegistry is already initialized');
    }

    console.log('[ServiceRegistry] Starting initialization...');
    this.startTime = Date.now();

    const levels = this.resolveInitializationLevels();

    // Build progress-tracking state
    const totalWeight = [...this.services.values()]
      .reduce((sum, reg) => sum + (reg.progressWeight ?? 1), 0);

    const statuses = new Map<string, ServiceStatus>();
    for (const name of this.services.keys()) statuses.set(name, 'pending');

    const subSteps = new Map<string, string>();

    const buildProgressEvent = (message: string): StartupProgressEvent => {
      let completedWeight = 0;
      for (const [name, status] of statuses) {
        if (status === 'complete') completedWeight += this.services.get(name)!.progressWeight ?? 1;
      }
      return {
        phase: 'initializing',
        progress: totalWeight > 0 ? Math.min(1, completedWeight / totalWeight) : 0,
        message,
        services: [...statuses.entries()].map(([name, status]) => ({
          name,
          status,
          progress: status === 'complete' ? 1 : 0,
          subStep: subSteps.get(name),
        })),
      };
    };

    // Initialize level by level; services within a level run in parallel
    for (const level of levels) {
      await Promise.all(level.map(async (name) => {
        const registration = this.services.get(name)!;
        const service = registration.service;
        const startMsg = registration.progressMessage ?? `Initializing ${name}...`;

        statuses.set(name, 'running');
        this.emit('service-started', { name, weight: registration.progressWeight ?? 1 });
        this.emit('startup-progress', buildProgressEvent(startMsg));

        if (service.initialize) {
          console.log(`[ServiceRegistry] Initializing ${name}...`);
          const start = Date.now();

          // Sub-progress callback for granular status updates
          const reportProgress: SubProgressCallback = (subStep: string) => {
            subSteps.set(name, subStep);
            this.emit('startup-progress', buildProgressEvent(startMsg));
          };

          try {
            await service.initialize(reportProgress);
            const elapsed = Date.now() - start;
            console.log(`[ServiceRegistry] ${name} initialized (${elapsed}ms)`);
          } catch (error: unknown) {
            statuses.set(name, 'failed');
            console.error(`[ServiceRegistry] Failed to initialize ${name}:`, error);
            throw error;
          }
        }

        statuses.set(name, 'complete');
        this.emit('service-complete', { name, elapsed: Date.now() - this.startTime });
        this.emit('startup-progress', buildProgressEvent(startMsg));
      }));
    }

    this.initialized = true;
    const totalTime = Date.now() - this.startTime;
    console.log(`[ServiceRegistry] All services initialized (${totalTime}ms)`);

    this.emit('startup-progress', {
      phase: 'ready',
      progress: 1,
      message: 'Server ready',
      services: [...statuses.entries()].map(([name, status]) => ({ name, status, progress: 1 })),
    } satisfies StartupProgressEvent);
    this.emit('initialized');
  }

  /**
   * Shutdown all services gracefully
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      console.log('[ServiceRegistry] Shutdown already in progress');
      return;
    }

    this.shuttingDown = true;
    console.log('[ServiceRegistry] Starting graceful shutdown...');
    this.emit('shutting-down');

    // Sort services by shutdown priority (higher first)
    const sortedServices = Array.from(this.services.entries())
      .sort((a, b) => (b[1].shutdownPriority ?? 0) - (a[1].shutdownPriority ?? 0));

    // Shutdown services in priority order
    for (const [name, registration] of sortedServices) {
      const service = registration.service;

      if (service.shutdown) {
        console.log(`[ServiceRegistry] Shutting down ${name}...`);

        try {
          await Promise.race([
            service.shutdown(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Shutdown timeout')), 5000)
            )
          ]);
          console.log(`[ServiceRegistry] ${name} shut down`);
        } catch (error: unknown) {
          console.error(`[ServiceRegistry] Error shutting down ${name}:`, error);
        }
      }
    }

    console.log('[ServiceRegistry] Graceful shutdown complete');
    this.emit('shutdown');
  }

  /**
   * Perform health check on all services
   */
  healthCheck(): HealthCheckResult {
    const result: HealthCheckResult = {
      healthy: true,
      services: {},
      uptime: this.initialized ? Date.now() - this.startTime : 0,
    };

    for (const [name, registration] of this.services) {
      const service = registration.service;
      const isHealthy = service.isHealthy ? service.isHealthy() : true;

      result.services[name] = {
        healthy: isHealthy,
        stats: service.getStats?.(),
      };

      if (!isHealthy) {
        result.healthy = false;
      }
    }

    return result;
  }

  /**
   * Get list of registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if registry is shutting down
   */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Reset the registry to its initial state.
   * Intended for tests: shuts down all services, then clears registrations
   * so the registry can be reused.
   */
  async reset(): Promise<void> {
    if (this.initialized && !this.shuttingDown) {
      await this.shutdown();
    }
    this.services.clear();
    this.initialized = false;
    this.shuttingDown = false;
    this.startTime = 0;
  }

  /**
   * Resolve initialization levels via BFS topological grouping.
   * Services at the same depth have no inter-dependencies and can run in parallel.
   * Throws on circular dependencies or unknown dependency references.
   */
  private resolveInitializationLevels(): string[][] {
    if (this.services.size === 0) return [];

    // --- cycle detection (DFS) ---
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const detectCycles = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Circular dependency detected: ${name}`);
      visiting.add(name);
      const reg = this.services.get(name);
      if (!reg) throw new Error(`Unknown service dependency: ${name}`);
      for (const dep of reg.dependsOn ?? []) detectCycles(dep);
      visiting.delete(name);
      visited.add(name);
    };
    for (const name of this.services.keys()) detectCycles(name);

    // --- depth assignment (longest path from roots) ---
    const depth = new Map<string, number>();
    const computeDepth = (name: string): number => {
      if (depth.has(name)) return depth.get(name)!;
      const deps = this.services.get(name)!.dependsOn ?? [];
      const d = deps.length === 0 ? 0 : Math.max(...deps.map(computeDepth)) + 1;
      depth.set(name, d);
      return d;
    };
    for (const name of this.services.keys()) computeDepth(name);

    const maxDepth = Math.max(...depth.values());
    const levels: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (const [name, d] of depth) levels[d].push(name);
    return levels;
  }
}

/**
 * Global service registry instance
 */
export const serviceRegistry = new ServiceRegistry();

/**
 * Extended server interface for graceful shutdown
 */
interface ShutdownServer {
  close: (cb?: () => void) => void;
  closeAllConnections?: () => void;
}

/**
 * Setup graceful shutdown handlers
 *
 * Shutdown behavior:
 * - First SIGINT/SIGTERM, or an uncaught exception: runs the injected shutdown sequence, which
 *   owns its own deadline and the process exit
 * - Second SIGINT: Force shutdown (kills all connections, exits after 500 ms)
 * - Third SIGINT: Immediate process.exit(1)
 */
export function setupGracefulShutdown(
  runShutdown: (reason: string) => Promise<void>,
  server?: ShutdownServer,
): void {
  let shutdownInProgress = false;
  let sigintCount = 0;

  const startShutdown = (reason: string): void => {
    shutdownInProgress = true;
    runShutdown(reason).catch(() => process.exit(1));
  };

  const onSignal = (signal: string): void => {
    sigintCount++;

    // Third signal = immediate exit
    if (sigintCount >= 3) {
      console.log('[Shutdown] Force exit!');
      process.exit(1);
      return;
    }

    // Second signal = force shutdown
    if (sigintCount === 2 && shutdownInProgress) {
      console.log('\n[Shutdown] Force shutdown requested (press Ctrl+C again for immediate exit)');

      // Force close all connections if server supports it
      if (server?.closeAllConnections) {
        console.log('[Shutdown] Closing all connections...');
        server.closeAllConnections();
      }

      // Give a brief moment then exit
      setTimeout(() => {
        console.log('[Shutdown] Force exiting...');
        process.exit(0);
      }, 500);
      return;
    }

    // First signal = graceful shutdown
    if (shutdownInProgress) {
      console.log(`[Shutdown] Already shutting down (press Ctrl+C again to force)`);
      return;
    }

    console.log(`\n[Shutdown] Received ${signal}, starting graceful shutdown...`);
    console.log('[Shutdown] Press Ctrl+C again to force shutdown');
    startShutdown(signal);
  };

  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  // Handle uncaught exceptions — same sequence; never counts as a SIGINT, so a second exception
  // thrown during the drain cannot force-exit in the middle of a logoff
  process.on('uncaughtException', (error) => {
    console.error('[Fatal] Uncaught exception:', error);
    if (!shutdownInProgress) startShutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Fatal] Unhandled rejection at:', promise, 'reason:', reason);
  });
}
