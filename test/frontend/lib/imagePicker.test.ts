describe('photo support in existing native clients', () => {
  afterEach(() => jest.resetModules());

  function loadPicker(platform: string, nativeModule: object | null) {
    const loadImplementation = jest.fn(() => ({ supported: true }));
    jest.doMock('react-native', () => ({ Platform: { OS: platform } }));
    jest.doMock('expo', () => ({ requireOptionalNativeModule: () => nativeModule }));
    jest.doMock('expo-image-picker', () => loadImplementation());
    const { imagePickerModule } = require('../../../src/lib/imagePicker');
    return { imagePickerModule, loadImplementation };
  }

  it('does not load image-picker when its native module is absent', () => {
    const { imagePickerModule, loadImplementation } = loadPicker('android', null);
    expect(imagePickerModule).toBeNull();
    expect(loadImplementation).not.toHaveBeenCalled();
  });

  it('loads photo support when the native module is present', () => {
    expect(loadPicker('android', {}).imagePickerModule).toEqual({ supported: true });
  });

  it('keeps the web picker available without a native module', () => {
    expect(loadPicker('web', null).imagePickerModule).toEqual({ supported: true });
  });
});
