import { PHP, SupportedPHPVersions, getPHPLoaderModule } from '..';
import { loadPHPRuntime, PHPRequestHandler } from '@php-wasm/common';
describe.each(SupportedPHPVersions)(
	'[PHP %s] PHPRequestHandler – request',
	(phpVersion) => {
		let php: PHP;
		let handler: PHPRequestHandler;
		beforeEach(async () => {
			const phpLoaderModule = await getPHPLoaderModule(phpVersion);
			const runtimeId = await loadPHPRuntime(phpLoaderModule);
			php = new PHP(runtimeId);
			handler = new PHPRequestHandler(php, {
				documentRoot: '/',
				isStaticFilePath: (path) => !path.endsWith('.php'),
			});
		});

		it('should execute a PHP file', async () => {
			php.writeFile('/index.php', `<?php echo 'Hello World';`);
			const response = await handler.request({
				url: '/index.php',
			});
			expect(response).toEqual({
				httpStatusCode: 200,
				headers: {
					'content-type': ['text/html; charset=UTF-8'],
					'x-powered-by': [expect.any(String)],
				},
				bytes: new TextEncoder().encode('Hello World'),
				errors: '',
				exitCode: 1, // @TODO This should be 0
			});
		});

		it('should serve a static file', async () => {
			php.writeFile('/index.html', `Hello World`);
			const response = await handler.request({
				url: '/index.html',
			});
			expect(response).toEqual({
				httpStatusCode: 200,
				headers: {
					'content-type': ['text/html'],

					'accept-ranges': ['bytes'],
					'cache-control': ['public, max-age=0'],
					'content-length': ['11'],
				},
				bytes: new TextEncoder().encode('Hello World'),
				errors: '',
				exitCode: 0,
			});
		});

		it('should only handle a single PHP request at a time', async () => {
			php.writeFile(
				'/index.php',
				`<?php
			// A unique function name to force a fatal error
			// if this file gets loaded twice during the same
			// request
			function a_function() {}
			// Use an async operation so that the second
			// request is dispatched before the first one
			// finishes
			@stream_socket_client('http://localhost:1235');
			echo 'Hello World';
		`
			);
			const response1 = handler.request({
				url: '/index.php',
			});
			expect(handler.isRequestRunning).toBe(true);
			// No stdout should be written yet
			expect(php.fileExists('/tmp/stdout')).toBe(false);
			const response2 = handler.request({
				url: '/index.php',
			});
			const [response1Result, response2Result] = await Promise.all([
				response1,
				response2,
			]);
			expect(response1Result).toEqual({
				httpStatusCode: 200,
				headers: {
					'content-type': ['text/html; charset=UTF-8'],
					'x-powered-by': [expect.any(String)],
				},
				bytes: new TextEncoder().encode('Hello World'),
				errors: '',
				exitCode: 1, // @TODO This should be 0
			});
			expect(response2Result).toEqual({
				httpStatusCode: 200,
				headers: {
					'content-type': ['text/html; charset=UTF-8'],
					'x-powered-by': [expect.any(String)],
				},
				bytes: new TextEncoder().encode('Hello World'),
				errors: '',
				exitCode: 1, // @TODO This should be 0
			});
		});

		it('Should not crash on move_uploaded_file', async () => {
			/**
			 * Tests against calling phpwasm_init_uploaded_files_hash() when
			 * the Content-type header is set to multipart/form-data. See the
			 * phpwasm_init_uploaded_files_hash() docstring for more info.
			 */
			await php.writeFile(
				'/index.php',
				`<?php 
				move_uploaded_file($_FILES["myFile"]["tmp_name"], '/tmp/moved.txt');
				echo json_encode(file_exists('/tmp/moved.txt'));`
			);
			const response = await handler.request({
				url: '/index.php',
				method: 'POST',
				files: {
					myFile: {
						name: 'text.txt',
						async arrayBuffer() {
							return new TextEncoder().encode('Hello World')
								.buffer;
						},
						type: 'text/plain',
					} as any,
				},
				headers: {
					'Content-Type': 'multipart/form-data; boundary=boundary',
				},
			});
			expect(response.text).toEqual('true');
		});

		it('Should handle an empty file object and post data', async () => {
			await php.writeFile(
				'/index.php',
				`<?php 
				echo json_encode($_POST);`
			);
			const response = await handler.request({
				url: '/index.php',
				method: 'POST',
				files: {},
				body: 'foo=bar',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			});
			expect(response.json).toEqual({ foo: 'bar' });
		});
	}
);