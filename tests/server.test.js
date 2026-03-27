const { createServer } = require('http');
const express = require('express');

describe('Server Configuration', () => {
  let server;
  
  afterEach((done) => {
    if (server && server.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  it('should create an HTTP server', () => {
    const app = express();
    server = createServer(app);
    
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
  });

  it('should start server on specified port', (done) => {
    const app = express();
    server = createServer(app);
    
    const port = 0; // Use 0 for random available port in tests
    server.listen(port, () => {
      expect(server.listening).toBe(true);
      done();
    });
  });

  it('should handle server errors gracefully', (done) => {
    const app = express();
    server = createServer(app);
    
    server.on('error', (error) => {
      expect(error).toBeDefined();
      expect(error.code).toBe('EADDRINUSE');
      done();
    });
    
    // Try to listen on an invalid port to trigger error
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => {
        const conflictServer = createServer(express());
        conflictServer.listen(port);
        server.listen(port);
      });
    });
  });
});