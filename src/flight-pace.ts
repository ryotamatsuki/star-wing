export type FlightPaceState = 'brake' | 'cruise' | 'boost';

export interface FlightPaceInput {
  boost: boolean;
  brake: boolean;
  enabled: boolean;
}

export interface FlightPaceController {
  update(dt: number, input: FlightPaceInput): void;
  reset(): void;
  readonly multiplier: number;
  readonly state: FlightPaceState;
  readonly fov: number;
}

export const FLIGHT_PACE_CONFIG = {
  brakeMultiplier: 0.65,
  cruiseMultiplier: 1,
  boostMultiplier: 1.4,
  cruiseFov: 70,
  brakeFov: 67,
  boostFov: 75,
  transitionSeconds: 0.2,
} as const;

function getRequestedState(input: FlightPaceInput): FlightPaceState {
  if (!input.enabled || input.boost === input.brake) return 'cruise';
  return input.boost ? 'boost' : 'brake';
}

function getMultiplier(state: FlightPaceState): number {
  if (state === 'boost') return FLIGHT_PACE_CONFIG.boostMultiplier;
  if (state === 'brake') return FLIGHT_PACE_CONFIG.brakeMultiplier;
  return FLIGHT_PACE_CONFIG.cruiseMultiplier;
}

function getFov(state: FlightPaceState): number {
  if (state === 'boost') return FLIGHT_PACE_CONFIG.boostFov;
  if (state === 'brake') return FLIGHT_PACE_CONFIG.brakeFov;
  return FLIGHT_PACE_CONFIG.cruiseFov;
}

class FlightPace implements FlightPaceController {
  private currentMultiplier = FLIGHT_PACE_CONFIG.cruiseMultiplier;
  private currentState: FlightPaceState = 'cruise';

  update(dt: number, input: FlightPaceInput): void {
    this.currentState = getRequestedState(input);
    const target = getMultiplier(this.currentState);
    const progress = Math.min(1, Math.max(0, dt / FLIGHT_PACE_CONFIG.transitionSeconds));
    this.currentMultiplier += (target - this.currentMultiplier) * progress;
  }

  reset(): void {
    this.currentState = 'cruise';
    this.currentMultiplier = FLIGHT_PACE_CONFIG.cruiseMultiplier;
  }

  get multiplier(): number { return this.currentMultiplier; }
  get state(): FlightPaceState { return this.currentState; }
  get fov(): number { return getFov(this.currentState); }
}

export const flightPace: FlightPaceController = new FlightPace();
