/**
 * Mock for @react-native-community/netinfo
 */

export interface NetInfoState {
  isConnected: boolean | null;
  type: string;
}

let _isConnected = true;

export function __setConnected(value: boolean): void {
  _isConnected = value;
}

const addEventListener = jest.fn(
  (callback: (state: NetInfoState) => void) => {
    // Immediately call with current state
    callback({ isConnected: _isConnected, type: 'wifi' });
    return () => {}; // unsubscribe no-op
  },
);

const fetch = jest.fn(async (): Promise<NetInfoState> => ({
  isConnected: _isConnected,
  type: 'wifi',
}));

export default { addEventListener, fetch };
