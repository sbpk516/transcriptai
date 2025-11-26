"""
Performance Benchmarking Tool for TranscriptAI Phase 1.3 Week 4.
Benchmarks the audio processing pipeline performance.
"""
import asyncio
import time
import statistics
import json
from pathlib import Path
from typing import Dict, List, Any
import sys
import os
from datetime import datetime

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from backend.app.pipeline_orchestrator import AudioProcessingPipeline
from backend.app.pipeline_monitor import pipeline_monitor
from backend.app.main import app
from fastapi.testclient import TestClient


class PipelineBenchmarker:
    """Benchmarks the audio processing pipeline performance."""
    
    def __init__(self):
        self.client = TestClient(app)
        self.pipeline = AudioProcessingPipeline()
        self.results = []
        
        # Create test audio files
        self.test_files_dir = Path("benchmark_test_files")
        self.test_files_dir.mkdir(exist_ok=True)
        self.create_test_files()
    
    def create_test_files(self):
        """Create test audio files of different sizes."""
        self.test_files = {}
        
        # Create files of different durations
        durations = [1, 5, 10, 30]  # seconds
        
        for duration in durations:
            file_path = self.test_files_dir / f"test_{duration}s.wav"
            
            # Use ffmpeg to create test files
            import subprocess
            try:
                subprocess.run([
                    "ffmpeg", "-f", "lavfi", 
                    "-i", f"anullsrc=channel_layout=stereo:sample_rate=44100",
                    "-t", str(duration), "-c:a", "pcm_s16le", 
                    str(file_path), "-y"
                ], check=True, capture_output=True)
                
                self.test_files[duration] = file_path
                print(f"Created test file: {file_path} ({duration}s)")
                
            except (subprocess.CalledProcessError, FileNotFoundError):
                # Fallback: create mock files
                with open(file_path, 'wb') as f:
                    # Create a minimal WAV file
                    f.write(b'RIFF' + b'\x00' * (44 + duration * 44100 * 4))
                
                self.test_files[duration] = file_path
                print(f"Created mock test file: {file_path} ({duration}s)")
    
    async def benchmark_single_pipeline(self, file_path: Path, duration: int) -> Dict[str, Any]:
        """Benchmark a single pipeline run."""
        start_time = time.time()
        
        with open(file_path, 'rb') as f:
            files = {'file': (file_path.name, f, 'audio/wav')}
            response = self.client.post("/api/v1/pipeline/upload", files=files)
        
        end_time = time.time()
        total_time = end_time - start_time
        
        if response.status_code == 200:
            result = response.json()
            
            # Extract timing information
            timeline = result.get('processing_timeline', {})
            step_timings = timeline.get('step_timings', {})
            
            step_times = {}
            for step, timing in step_timings.items():
                if timing.get('duration_seconds'):
                    step_times[step] = timing['duration_seconds']
            
            return {
                'duration_seconds': duration,
                'total_time': total_time,
                'success': True,
                'call_id': result.get('call_id'),
                'step_times': step_times,
                'pipeline_status': result.get('pipeline_status'),
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'duration_seconds': duration,
                'total_time': total_time,
                'success': False,
                'error': response.text,
                'status_code': response.status_code,
                'timestamp': datetime.now().isoformat()
            }
    
    async def run_benchmark_suite(self, runs_per_file: int = 3) -> Dict[str, Any]:
        """Run complete benchmark suite."""
        print(f"Starting benchmark suite with {runs_per_file} runs per file...")
        
        all_results = []
        
        for duration, file_path in self.test_files.items():
            print(f"\nBenchmarking {duration}s audio file...")
            
            file_results = []
            for run in range(runs_per_file):
                print(f"  Run {run + 1}/{runs_per_file}...")
                
                result = await self.benchmark_single_pipeline(file_path, duration)
                file_results.append(result)
                
                # Small delay between runs
                await asyncio.sleep(1)
            
            all_results.extend(file_results)
            
            # Calculate statistics for this file duration
            successful_runs = [r for r in file_results if r['success']]
            if successful_runs:
                total_times = [r['total_time'] for r in successful_runs]
                
                print(f"  Results for {duration}s file:")
                print(f"    Successful runs: {len(successful_runs)}/{runs_per_file}")
                print(f"    Average time: {statistics.mean(total_times):.2f}s")
                print(f"    Min time: {min(total_times):.2f}s")
                print(f"    Max time: {max(total_times):.2f}s")
                print(f"    Std dev: {statistics.stdev(total_times):.2f}s")
        
        return self.analyze_benchmark_results(all_results)
    
    def analyze_benchmark_results(self, results: List[Dict]) -> Dict[str, Any]:
        """Analyze benchmark results and generate statistics."""
        successful_results = [r for r in results if r['success']]
        failed_results = [r for r in results if not r['success']]
        
        # Group by file duration
        results_by_duration = {}
        for result in successful_results:
            duration = result['duration_seconds']
            if duration not in results_by_duration:
                results_by_duration[duration] = []
            results_by_duration[duration].append(result)
        
        # Calculate statistics for each duration
        duration_stats = {}
        for duration, duration_results in results_by_duration.items():
            total_times = [r['total_time'] for r in duration_results]
            
            # Calculate step timing averages
            step_times_avg = {}
            all_steps = set()
            for result in duration_results:
                all_steps.update(result['step_times'].keys())
            
            for step in all_steps:
                step_times = [r['step_times'].get(step, 0) for r in duration_results]
                step_times = [t for t in step_times if t > 0]  # Filter out zeros
                if step_times:
                    step_times_avg[step] = {
                        'avg': statistics.mean(step_times),
                        'min': min(step_times),
                        'max': max(step_times),
                        'std_dev': statistics.stdev(step_times) if len(step_times) > 1 else 0
                    }
            
            duration_stats[duration] = {
                'count': len(duration_results),
                'total_time': {
                    'avg': statistics.mean(total_times),
                    'min': min(total_times),
                    'max': max(total_times),
                    'std_dev': statistics.stdev(total_times) if len(total_times) > 1 else 0
                },
                'step_times': step_times_avg,
                'throughput': len(duration_results) / sum(total_times)  # pipelines per second
            }
        
        # Overall statistics
        all_total_times = [r['total_time'] for r in successful_results]
        
        benchmark_summary = {
            'timestamp': datetime.now().isoformat(),
            'total_runs': len(results),
            'successful_runs': len(successful_results),
            'failed_runs': len(failed_results),
            'success_rate': len(successful_results) / len(results) if results else 0,
            'overall_stats': {
                'avg_total_time': statistics.mean(all_total_times) if all_total_times else 0,
                'min_total_time': min(all_total_times) if all_total_times else 0,
                'max_total_time': max(all_total_times) if all_total_times else 0,
                'std_dev_total_time': statistics.stdev(all_total_times) if len(all_total_times) > 1 else 0
            },
            'duration_stats': duration_stats,
            'failed_results': failed_results,
            'raw_results': results
        }
        
        return benchmark_summary
    
    def save_benchmark_results(self, results: Dict[str, Any], filename: str = None):
        """Save benchmark results to file."""
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"benchmark_results_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"\nBenchmark results saved to: {filename}")
    
    def print_benchmark_summary(self, results: Dict[str, Any]):
        """Print a summary of benchmark results."""
        print("\n" + "="*60)
        print("BENCHMARK SUMMARY")
        print("="*60)
        
        print(f"Total runs: {results['total_runs']}")
        print(f"Successful runs: {results['successful_runs']}")
        print(f"Failed runs: {results['failed_runs']}")
        print(f"Success rate: {results['success_rate']:.2%}")
        
        print(f"\nOverall Performance:")
        overall = results['overall_stats']
        print(f"  Average total time: {overall['avg_total_time']:.2f}s")
        print(f"  Min total time: {overall['min_total_time']:.2f}s")
        print(f"  Max total time: {overall['max_total_time']:.2f}s")
        print(f"  Standard deviation: {overall['std_dev_total_time']:.2f}s")
        
        print(f"\nPerformance by File Duration:")
        for duration, stats in results['duration_stats'].items():
            print(f"  {duration}s files ({stats['count']} runs):")
            total_time = stats['total_time']
            print(f"    Average: {total_time['avg']:.2f}s")
            print(f"    Min: {total_time['min']:.2f}s")
            print(f"    Max: {total_time['max']:.2f}s")
            print(f"    Throughput: {stats['throughput']:.3f} pipelines/sec")
            
            if stats['step_times']:
                print(f"    Step breakdown:")
                for step, step_stats in stats['step_times'].items():
                    print(f"      {step}: {step_stats['avg']:.2f}s avg")
        
        if results['failed_results']:
            print(f"\nFailed Runs:")
            for failure in results['failed_results']:
                print(f"  {failure['duration_seconds']}s file: {failure.get('error', 'Unknown error')}")


async def main():
    """Run the benchmark suite."""
    print("TranscriptAI Pipeline Performance Benchmark")
    print("="*50)
    
    benchmarker = PipelineBenchmarker()
    
    try:
        # Run benchmark suite
        results = await benchmarker.run_benchmark_suite(runs_per_file=3)
        
        # Print summary
        benchmarker.print_benchmark_summary(results)
        
        # Save results
        benchmarker.save_benchmark_results(results)
        
        # Get performance metrics
        performance_response = benchmarker.client.get("/api/v1/monitor/performance")
        if performance_response.status_code == 200:
            performance_data = performance_response.json()
            print(f"\nSystem Performance Metrics:")
            print(f"  Active pipelines: {performance_data['performance_summary']['active_pipelines']}")
            
            system_metrics = performance_data['performance_summary']['system_metrics']
            if 'error' not in system_metrics:
                print(f"  CPU usage: {system_metrics['cpu_percent']:.1f}%")
                print(f"  Memory usage: {system_metrics['memory_percent']:.1f}%")
                print(f"  Available memory: {system_metrics['memory_available_gb']:.1f}GB")
                print(f"  Disk usage: {system_metrics['disk_percent']:.1f}%")
        
    except Exception as e:
        print(f"Benchmark failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
