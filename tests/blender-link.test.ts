import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {BlenderLink} from '../src/destinations/blender-link';

const host = vi.hoisted(() => ({
  connect: vi.fn(), raw: vi.fn(), op: vi.fn(), close: vi.fn(),
}));
vi.mock('../src/blender-client', () => ({BlenderClient: class {
  connect = host.connect; raw = host.raw; op = host.op; close = host.close;
}}));
beforeEach(() => {
  vi.useFakeTimers();
  host.connect.mockResolvedValue(['execute_blender_code','look']);
  // Upstream can return an ordinary text error without isError=true.
  host.raw.mockResolvedValue({content:[{type:'text',text:'Could not connect to Blender'}]});
  host.op.mockResolvedValue({active:true});
  host.close.mockResolvedValue(undefined);
});
afterEach(() => {vi.useRealTimers();vi.resetAllMocks();});

it('does not advertise tool discovery as a live Blender connection, and retries when the host returns', async () => {
  const link = new BlenderLink('/unused');
  host.op.mockRejectedValueOnce(new Error('Could not connect to Blender'));
  await link.connect();
  expect(link.destination().describe?.()).toEqual({connected:false,detail:'Blender 未连接'});
  expect(link.state.active).toBe(false);
  expect(host.close).toHaveBeenCalledTimes(1);
  await link.connect();
  expect(link.connected).toBe(true);
  expect(link.state.active).toBe(true);
  expect(host.op).toHaveBeenLastCalledWith('mode',{active:true});
});

it('detects host loss after connection and reconnects without resetting the scene', async () => {
  const link = new BlenderLink('/unused');
  await link.connect();
  host.op.mockRejectedValueOnce(new Error('host closed'));
  await vi.advanceTimersByTimeAsync(5001);
  await link.connect();
  expect(link.connected).toBe(false);
  expect(host.op).toHaveBeenLastCalledWith('status');
  await link.connect();
  expect(link.connected).toBe(true);
  expect(host.op.mock.calls.map(c=>c[0])).toEqual(['mode','status','mode']);
});

it('shares an in-flight host handshake and requires enabled drop mode', async () => {
  const link = new BlenderLink('/unused');
  let finish!: (result:{active:boolean}) => void;
  host.op.mockReturnValueOnce(new Promise(resolve => {finish=resolve;}));
  const first=link.connect(),second=link.connect();
  await vi.waitFor(() => expect(host.op).toHaveBeenCalledTimes(1));
  expect(link.connected).toBe(false);
  finish({active:false});
  await Promise.all([first,second]);
  expect(link.connected).toBe(false);
  expect(host.connect).toHaveBeenCalledTimes(1);
  expect(host.close).toHaveBeenCalledTimes(1);
});
