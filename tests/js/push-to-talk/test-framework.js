#!/usr/bin/env node

/**
 * Push-to-Talk Test Framework
 * Provides utilities for creating automated PASS/FAIL tests
 */

// ANSI color codes (no external dependencies)
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

class TestFramework {
  constructor(phaseName) {
    this.phaseName = phaseName;
    this.tests = [];
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
    };
    this.failedTests = new Set();
  }

  /**
   * Register a test case
   * @param {string} name - Test name
   * @param {Function} testFn - Async test function that returns { pass: boolean, message?: string }
   * @param {string[]} dependencies - Array of test names this depends on
   */
  test(name, testFn, dependencies = []) {
    this.tests.push({ name, testFn, dependencies, executed: false });
  }

  /**
   * Run all registered tests
   */
  async run() {
    console.log(`${colors.blue}${colors.bold}\n[${this.phaseName}]${colors.reset}`);
    
    for (const test of this.tests) {
      // Check if dependencies failed
      const failedDeps = test.dependencies.filter(dep => this.failedTests.has(dep));
      
      if (failedDeps.length > 0) {
        console.log(`${colors.gray}  - SKIP: ${test.name} (dependency failed: ${failedDeps.join(', ')})${colors.reset}`);
        this.results.skipped++;
        continue;
      }
      
      try {
        const result = await test.testFn();
        
        if (result.pass) {
          console.log(`${colors.green}  ✓ PASS: ${test.name}${colors.reset}`);
          this.results.passed++;
        } else {
          const message = result.message ? ` - ${result.message}` : '';
          console.log(`${colors.red}  ✗ FAIL: ${test.name}${message}${colors.reset}`);
          this.results.failed++;
          this.failedTests.add(test.name);
        }
        
        test.executed = true;
      } catch (error) {
        console.log(`${colors.red}  ✗ FAIL: ${test.name} - Exception: ${error.message}${colors.reset}`);
        this.results.failed++;
        this.failedTests.add(test.name);
      }
    }
    
    return this.results;
  }

  /**
   * Print summary
   */
  printSummary() {
    const total = this.results.passed + this.results.failed + this.results.skipped;
    console.log(`${colors.yellow}\nSummary: ${this.results.passed} PASS, ${this.results.failed} FAIL, ${this.results.skipped} SKIP (${total} total)${colors.reset}`);
    
    if (this.results.failed > 0) {
      const firstFailedTest = this.tests.find(t => this.failedTests.has(t.name));
      if (firstFailedTest) {
        console.log(`${colors.red}Breaking Point: ${this.phaseName}, Test: ${firstFailedTest.name}${colors.reset}`);
      }
    }
    
    return this.results.failed === 0;
  }
}

/**
 * Utility functions for tests
 */
const TestUtils = {
  /**
   * Check if a log file contains a specific pattern
   */
  async checkLogContains(logPath, pattern, timeoutMs = 5000) {
    const fs = require('fs').promises;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const content = await fs.readFile(logPath, 'utf8');
        if (pattern instanceof RegExp) {
          if (pattern.test(content)) {
            return true;
          }
        } else if (content.includes(pattern)) {
          return true;
        }
      } catch (err) {
        // File might not exist yet
      }
      
      await this.sleep(100);
    }
    
    return false;
  },

  /**
   * Check if a file exists
   */
  async fileExists(path) {
    const fs = require('fs').promises;
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Read JSON file
   */
  async readJSON(path) {
    const fs = require('fs').promises;
    try {
      const content = await fs.readFile(path, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      return null;
    }
  },

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Check if process is running
   */
  async isProcessRunning(processName) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    try {
      const { stdout } = await execPromise(`pgrep -f "${processName}"`);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  },

  /**
   * Make HTTP request
   */
  async httpRequest(url, options = {}) {
    const http = url.startsWith('https') ? require('https') : require('http');
    
    return new Promise((resolve, reject) => {
      const req = http.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      });
      
      req.on('error', reject);
      req.setTimeout(options.timeout || 3000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  },
};

module.exports = { TestFramework, TestUtils };

