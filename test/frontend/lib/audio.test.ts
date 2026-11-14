describe('audio support in existing native clients', () => {
  afterEach(() => jest.resetModules());

  function loadAudio(platform: string, nativeModule: object | null) {
    const loadImplementation = jest.fn(() => ({ supported: true }));
    jest.doMock('react-native', () => ({ Platform: { OS: platform } }));
    jest.doMock('expo', () => ({ requireOptionalNativeModule: () => nativeModule }));
    jest.doMock('expo-audio', () => loadImplementation());
    const { audioModule } = require('../../../src/lib/audio');
    return { audioModule, loadImplementation };
  }

  it('does not import the throwing audio implementation when the APK lacks ExpoAudio', () => {
    const { audioModule, loadImplementation } = loadAudio('android', null);
    expect(audioModule).toBeNull();
    expect(loadImplementation).not.toHaveBeenCalled();
  });

  it('loads audio in clients that include the native module', () => {
    const { audioModule, loadImplementation } = loadAudio('android', {});
    expect(audioModule).toEqual({ supported: true });
    expect(loadImplementation).toHaveBeenCalledTimes(1);
  });

  it('keeps web audio available without a native module', () => {
    const { audioModule, loadImplementation } = loadAudio('web', null);
    expect(audioModule).toEqual({ supported: true });
    expect(loadImplementation).toHaveBeenCalledTimes(1);
  });
});
