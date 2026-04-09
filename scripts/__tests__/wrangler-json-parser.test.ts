import { describe, it, expect } from 'bun:test';
import { WranglerParsers } from './test-utils';

describe('Wrangler --json 输出解析测试', () => {
    describe('parseCount', () => {
        it('应该正确解析 --json 格式的 count 查询', () => {
            const wranglerOutput = JSON.stringify([{
                results: [{ count: 0 }],
                success: true,
                meta: { served_by: "v3-prod", duration: 0.2563 }
            }]);

            console.log('\n测试 --json count 解析:');
            console.log('  输入:', wranglerOutput);
            
            const count = WranglerParsers.parseCount(wranglerOutput);
            console.log('  解析结果:', count);
            
            expect(count).toBe(0);
        });

        it('应该正确解析 --json 格式的非零 count', () => {
            const wranglerOutput = JSON.stringify([{
                results: [{ count: 27489 }],
                success: true,
                meta: {}
            }]);

            const count = WranglerParsers.parseCount(wranglerOutput);
            console.log('\n测试 --json 非零 count:', count);
            
            expect(count).toBe(27489);
        });

        it('应该处理空的 results', () => {
            const wranglerOutput = JSON.stringify([{ results: [], success: true, meta: {} }]);
            const count = WranglerParsers.parseCount(wranglerOutput);
            expect(count).toBe(0);
        });
    });

    describe('parsePostIds', () => {
        it('应该正确解析 --json 格式的 post_id 列表', () => {
            const wranglerOutput = JSON.stringify([{
                results: [{ post_id: 1 }, { post_id: 2 }, { post_id: 3 }, { post_id: 42 }],
                success: true,
                meta: {}
            }]);

            console.log('\n测试 --json post_id 解析:');
            console.log('  输入:', wranglerOutput);
            
            const postIds = WranglerParsers.parsePostIds(wranglerOutput);
            console.log('  解析结果:', postIds);
            
            expect(postIds).toEqual([1, 2, 3, 42]);
            expect(postIds.length).toBe(4);
        });

        it('应该处理空的 results', () => {
            const wranglerOutput = JSON.stringify([{ results: [], success: true, meta: {} }]);
            const postIds = WranglerParsers.parsePostIds(wranglerOutput);
            expect(postIds).toEqual([]);
        });
    });

    describe('parseIPs', () => {
        it('应该正确解析 --json 格式的 IP 列表', () => {
            const wranglerOutput = JSON.stringify([{
                results: [
                    { ip: '192.168.1.1' },
                    { ip: '192.168.1.2' },
                    { ip: '10.0.0.1' },
                    { ip: '172.16.0.1' }
                ],
                success: true,
                meta: {}
            }]);

            console.log('\n测试 --json IP 解析:');
            console.log('  输入:', wranglerOutput);
            
            const ips = WranglerParsers.parseIPs(wranglerOutput);
            console.log('  解析结果:', ips);
            
            expect(ips).toEqual(['192.168.1.1', '192.168.1.2', '10.0.0.1', '172.16.0.1']);
            expect(ips.length).toBe(4);
        });

        it('应该处理空的 results', () => {
            const wranglerOutput = JSON.stringify([{ results: [], success: true, meta: {} }]);
            const ips = WranglerParsers.parseIPs(wranglerOutput);
            expect(ips).toEqual([]);
        });
    });

    describe('边界情况', () => {
        it('应该处理所有解析器的空 results', () => {
            const wranglerOutput = JSON.stringify([{ results: [], success: true, meta: {} }]);

            const count = WranglerParsers.parseCount(wranglerOutput);
            const postIds = WranglerParsers.parsePostIds(wranglerOutput);
            const ips = WranglerParsers.parseIPs(wranglerOutput);

            console.log('\n测试空 results:');
            console.log('  count:', count);
            console.log('  postIds:', postIds);
            console.log('  ips:', ips);

            expect(count).toBe(0);
            expect(postIds).toEqual([]);
            expect(ips).toEqual([]);
        });
    });
});
