function installModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

function mockPrisma(impl) {
  installModule(require.resolve("../../src/config/database"), impl);
  return impl;
}

function noopService() {
  return new Proxy(
    {},
    {
      get: () => async () => ({}),
    }
  );
}

function stubSideEffects() {
  const noop = noopService();
  try {
    installModule(require.resolve("../../src/services/email.service"), noop);
  } catch {
    // optional
  }
  try {
    installModule(require.resolve("../../src/services/whatsapp.service"), noop);
  } catch {
    // optional
  }
  try {
    installModule(require.resolve("../../src/services/notification.service"), noop);
  } catch {
    // optional
  }
}

module.exports = { mockPrisma, stubSideEffects, installModule };
