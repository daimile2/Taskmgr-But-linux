export namespace main {
	
	export class DiskInfo {
	    name: string;
	    model: string;
	    util: number;
	    readBps: number;
	    writeBps: number;
	    sizeBytes: number;
	    rotational: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DiskInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.model = source["model"];
	        this.util = source["util"];
	        this.readBps = source["readBps"];
	        this.writeBps = source["writeBps"];
	        this.sizeBytes = source["sizeBytes"];
	        this.rotational = source["rotational"];
	    }
	}
	export class GPUInfo {
	    name: string;
	    kind: string;
	    usage: number;
	    temp: number;
	    detail: string;
	
	    static createFrom(source: any = {}) {
	        return new GPUInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.usage = source["usage"];
	        this.temp = source["temp"];
	        this.detail = source["detail"];
	    }
	}
	export class NetDevice {
	    name: string;
	    kind: string;
	    rxBps: number;
	    txBps: number;
	    rxBytes: number;
	    txBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new NetDevice(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.rxBps = source["rxBps"];
	        this.txBps = source["txBps"];
	        this.rxBytes = source["rxBytes"];
	        this.txBytes = source["txBytes"];
	    }
	}
	export class PerfExtra {
	    nets: NetDevice[];
	    gpus: GPUInfo[];
	    disks: DiskInfo[];
	
	    static createFrom(source: any = {}) {
	        return new PerfExtra(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nets = this.convertValues(source["nets"], NetDevice);
	        this.gpus = this.convertValues(source["gpus"], GPUInfo);
	        this.disks = this.convertValues(source["disks"], DiskInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Process {
	    pid: number;
	    ppid: number;
	    name: string;
	    user: string;
	    state: string;
	    cpu: number;
	    memory: number;
	    memPct: number;
	    threads: number;
	    cmdline: string;
	
	    static createFrom(source: any = {}) {
	        return new Process(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.ppid = source["ppid"];
	        this.name = source["name"];
	        this.user = source["user"];
	        this.state = source["state"];
	        this.cpu = source["cpu"];
	        this.memory = source["memory"];
	        this.memPct = source["memPct"];
	        this.threads = source["threads"];
	        this.cmdline = source["cmdline"];
	    }
	}
	export class ProcessProps {
	    pid: number;
	    name: string;
	    state: string;
	    user: string;
	    cpu: number;
	    memory: number;
	    cmdline: string;
	    cwd: string;
	    exe: string;
	    nice: string;
	    threads: number;
	    affinity: string;
	
	    static createFrom(source: any = {}) {
	        return new ProcessProps(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.name = source["name"];
	        this.state = source["state"];
	        this.user = source["user"];
	        this.cpu = source["cpu"];
	        this.memory = source["memory"];
	        this.cmdline = source["cmdline"];
	        this.cwd = source["cwd"];
	        this.exe = source["exe"];
	        this.nice = source["nice"];
	        this.threads = source["threads"];
	        this.affinity = source["affinity"];
	    }
	}
	export class ServiceRow {
	    name: string;
	    pid: number;
	    description: string;
	    status: string;
	    group: string;
	    unit: string;
	
	    static createFrom(source: any = {}) {
	        return new ServiceRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.pid = source["pid"];
	        this.description = source["description"];
	        this.status = source["status"];
	        this.group = source["group"];
	        this.unit = source["unit"];
	    }
	}
	export class StartupApp {
	    name: string;
	    exec: string;
	    path: string;
	    enabled: boolean;
	    comment: string;
	
	    static createFrom(source: any = {}) {
	        return new StartupApp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.exec = source["exec"];
	        this.path = source["path"];
	        this.enabled = source["enabled"];
	        this.comment = source["comment"];
	    }
	}
	export class SystemStats {
	    cpuPercent: number;
	    memUsed: number;
	    memTotal: number;
	    memPercent: number;
	    processCount: number;
	    cpuModel: string;
	    cpuCores: number;
	    cpuMhz: number;
	    uptimeSec: number;
	    load1: number;
	    load5: number;
	    load15: number;
	    netRx: number;
	    netTx: number;
	
	    static createFrom(source: any = {}) {
	        return new SystemStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cpuPercent = source["cpuPercent"];
	        this.memUsed = source["memUsed"];
	        this.memTotal = source["memTotal"];
	        this.memPercent = source["memPercent"];
	        this.processCount = source["processCount"];
	        this.cpuModel = source["cpuModel"];
	        this.cpuCores = source["cpuCores"];
	        this.cpuMhz = source["cpuMhz"];
	        this.uptimeSec = source["uptimeSec"];
	        this.load1 = source["load1"];
	        this.load5 = source["load5"];
	        this.load15 = source["load15"];
	        this.netRx = source["netRx"];
	        this.netTx = source["netTx"];
	    }
	}
	export class UserRow {
	    name: string;
	    uid: string;
	    processCount: number;
	    cpu: number;
	    memory: number;
	
	    static createFrom(source: any = {}) {
	        return new UserRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.uid = source["uid"];
	        this.processCount = source["processCount"];
	        this.cpu = source["cpu"];
	        this.memory = source["memory"];
	    }
	}

}

