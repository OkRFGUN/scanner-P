
// Simple test script to diagnose API issues
import http from 'node:http';

console.log('Testing scanner-P API endpoints...\n');

// Test /api/modules
testEndpoint('/api/modules', 'Modules endpoint');

// Test /api/tasks
testEndpoint('/api/tasks', 'Tasks endpoint');

// Test /api/compliance
testEndpoint('/api/compliance', 'Compliance endpoint');

function testEndpoint(path, description) {
  const options = {
    hostname: '127.0.0.1',
    port: 4173,
    path: path,
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    console.log(`\n${description}:`);
    console.log(`  Status: ${res.statusCode} ${res.statusMessage}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        console.log(`  Success:`, Object.keys(parsed));
        if (parsed.modules) console.log(`  Modules count:`, parsed.modules.length);
        if (parsed.plusModules) console.log(`  Plus modules count:`, parsed.plusModules.length);
        if (parsed.tasks) console.log(`  Tasks count:`, parsed.tasks.length);
      } catch (e) {
        console.log(`  Response:`, data.substring(0, 200));
      }
    });
  });

  req.on('error', (e) => {
    console.error(`\n${description} error: ${e.message}`);
  });

  req.end();
}
