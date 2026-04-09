#!/usr/bin/env bun
/**
 * Migration script to convert existing visits data to HyperLogLog format
 * Run this after deploying the new schema (0006.sql)
 * 
 * Usage: bun run scripts/migrate-visits.ts
 */

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from '../src/db/schema';
import { HyperLogLog } from '../src/utils/hyperloglog';
import { eq } from 'drizzle-orm';

const { visits, visitStats } = schema;

const dbPath = process.env.DB_PATH || './data.db';

async function migrate() {
    console.log('Starting visits migration to HyperLogLog format...');
    console.log(`Using database: ${dbPath}`);
    
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    
    try {
        // Get all visits grouped by post_id
        console.log('Fetching visits data...');
        const allVisits = await db.select({
            postId: visits.postId,
            ip: visits.ip
        }).from(visits);
        
        // Group by post_id
        const groupedVisits = new Map<number, string[]>();
        for (const visit of allVisits) {
            if (!groupedVisits.has(visit.postId)) {
                groupedVisits.set(visit.postId, []);
            }
            groupedVisits.get(visit.postId)!.push(visit.ip);
        }
        
        console.log(`Found ${allVisits.length} visits across ${groupedVisits.size} posts`);
        
        // Process each post
        let processed = 0;
        for (const [postId, ips] of groupedVisits) {
            // Check if stats already exist
            const existing = await db.query.visitStats.findFirst({
                where: eq(visitStats.postId, postId)
            });
            
            if (existing && existing.hllData) {
                // Already migrated, skip
                console.log(`  Post ${postId}: already migrated (skipping)`);
                continue;
            }
            
            // Create HLL from IPs
            const hll = new HyperLogLog();
            for (const ip of ips) {
                hll.add(ip);
            }
            
            const pv = ips.length;
            const uv = Math.round(hll.count());
            const hllData = hll.serialize();
            
            if (existing) {
                // Update existing record
                await db.update(visitStats)
                    .set({ 
                        pv, 
                        hllData,
                        updatedAt: new Date()
                    })
                    .where(eq(visitStats.postId, postId));
            } else {
                // Insert new record
                await db.insert(visitStats).values({
                    postId,
                    pv,
                    hllData
                });
            }
            
            processed++;
            console.log(`  Post ${postId}: pv=${pv}, uv=${uv} (estimated)`);
            
            // Progress every 100 posts
            if (processed % 100 === 0) {
                console.log(`Progress: ${processed}/${groupedVisits.size} posts processed`);
            }
        }
        
        console.log(`\nMigration complete! Processed ${processed} posts.`);
        console.log(`Total visits migrated: ${allVisits.length}`);
        
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        sqlite.close();
    }
}

migrate();
