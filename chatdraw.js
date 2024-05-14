const make_cursor=(size=1)=>{
	const r = size/2+1 //  3->
	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${r*2}" height="${r*2}">
<rect x="${r-0.5}" y="${r-0.5}" width="1" height="1"/>
<rect x="${0.5}" y="${0.5}" width="${r*2-1}" height="${r*2-1}" fill="none" stroke="red" stroke-width="1"/>
</svg>
		`
	const ox = r-0.5
	const oy = r-0.5
	const url = "data:image/svg+xml;base64,"+btoa(svg)
	
	return `url("${url}") ${ox} ${oy}, crosshair`
}

let download
{
	const link = document.createElement('a')
	download = (url, filename)=>{
		link.href = url
		link.download = filename
		link.click()
	}
}


let dupe = (array, index, value) => {
	let arr = [...array]
	arr[index] = value
	return arr
}

function make_pattern(str, name, context) {
	const rows = str.split("/")
	const w = rows[0].length
	const h = rows.length
	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	const c2d = canvas.getContext('2d')
	const data = c2d.createImageData(w, h)
	for (let y=0; y<h; y++)
		for (let x=0; x<w; x++)
			if (rows[y][x]!="#")
				data.data[x+y*w<<2|3] = 0xFF
	c2d.putImageData(data, 0, 0)
	const invert = context.createPattern(canvas, 'repeat')
	
	c2d.globalCompositeOperation = 'xor'
	c2d.fillRect(0, 0, w, h)
	const pattern = context.createPattern(canvas, 'repeat')
	pattern._invert = invert
	pattern._invert._normal = pattern
	
	//c2d.globalCompositeOperation = 'destination-over'
	//c2d.fillStyle = '#f0e0aa'
	//c2d.fillRect(0, 0, w, h)
	// hack: we want a larger canvas to use as a button label
	/*canvas.width = 7
	canvas.height = 5
	for (let y=0;y<5;y+=4)
		for (let x=-3;x<8;x+=4)
			c2d.putImageData(data, x, y)*/
	pattern._label = [canvas, name]
	canvas.style.setProperty('--pw', w)
	canvas.style.setProperty('--ph', h)
	return pattern
}

// todo: merge in that change from the failed branch where we pass actual button elements here instead of descriptors. that way we can draw the 3 types of buttons where needed and not need to deal with like  

// also: i would like to put the "actions" block horizontally, either above or below the tools (and maybe patterns too?) idk. do feel like the FILL button doesnt belong there. technically it should be a brush but thats silly. could probably just remove reset though, idk. nice to have. for like, need a blank canvas temporarily, reset then undo>
function draw_form(choices, actions, sections) {
	function draw_button({type='button', name, value="", label:[label, title="", icon=false]}) {
		// hidden input element
		const input = document.createElement('input')
		Object.assign(input, {type, name, value, title})
		// the visible button
		const btn = document.createElement('button')
		if (icon)
			btn.classList.add('icon')
		btn.append(label)
		const cont = document.createElement('chatdraw-button')
		cont.append(input, btn)
		return cont
	}
	
	const form = document.createElement('form')
	form.autocomplete = 'off'
	form.method = 'dialog'
	form.onchange = ev=>{
		const e = ev.target
		if (ev.isTrusted)
			actions[e.name]?.(e.value, e)
		if (e.type=='radio')
			choices[e.name].change(e.value)
	}
	form.onclick = ev=>{
		const e = ev.target
		if (e.type=='button' || e.type=='radio')
			actions[e.name]?.(e.value)
	}
	//
	for (let {title, items, cols, small=false} of sections) {
		// legend
		const label = document.createElement('div')
		label.append(title)
		
		const sect = document.createElement('fieldset')
		sect.append(label)
		// buttons
		for (const sb of items)
			sect.append(draw_button(sb))
		// grid
		// todo: clean up the rows cols thing
		if (small)
			sect.classList.add('small')
		if (!cols) {
			cols = Math.ceil(items.length/(small ? 8 : 4))
			/*sect.style.gridAutoFlow = 'column'*/
		}
		sect.style.setProperty('--cols', cols)
		
		form.append(sect, document.createElement('hr'))
	}
	form.lastChild.remove() // last hr
	return form
}

// ugh we need to clean this system up.
// 1: .values should be a list of objects, containing the value, button, etc.
//  - thus: way to reference a choice by something other than index (i.e. this object)
// 2: need a way to change the value of an item that also calls onchange if it is selected
// 3: nicer way to handle drawing (pass label/tooltip together)
class Choices {
	constructor(name, values, change, label) {
		this.name = name
		this.values = values
		this.onchange = change
		this.label = label
		this.buttons = this.values.map((x,i)=>{
			return {type:'radio', name:this.name, value:i, label:this.label(x,i)}
		})
	}
	change(i) {
		this.onchange(this.values[i], i)
	}
}

const QUERY = window.location.search.match(/(\d+)x(\d+)(?:c(\d+))?/) || [null, "200", "100", false]
const WW = Number(QUERY[1])
const WH = Number(QUERY[2])
const MULTI = Number(QUERY[3]) || 6

class ChatDraw extends HTMLElement {
	width = WW || 200
	height = WH || 100
	palsize = Math.max(2,Math.min(MULTI,16))
	
	grp = new Grp(this.width, this.height)
	layers = [this.grp]
	panels = [this.layers]
	overlay = new Grp(this.width, this.height)
	img = new Image(this.width, this.height)
	form = null
	choices = null
	
	history = null
	tool = null
	color = 0
	clipboard = null
	activelayer = 0
	activepanel = 0
	focus = false
	speed = 0
	trace = 0
	
	play = false
	playing = false
	timer = 0
	
	traced = new Grp(this.width, this.height)
	
	flip = false
	flop = false
	
	constructor() {
		super()
		Object.seal(this)
		
		this.grp.canvas.classList.add('main')
		this.grp.canvas.id = "layer1"
		this.grp.thumbcanvas.classList.add('selected')
		this.overlay.canvas.classList.add('overlay')
		/// define brushes ///
		const brushes = []
		for (let i=1; i<=8; i++)
			brushes.push(Brush.Square(i, true, [`${i}▞`, `square ${i}×${i} thin`]))
		for (let i=1; i<=8; i++)
			brushes.push(Brush.Square(i, false, [`${i}▛`, `square ${i}×${i} thick`]))
		for (let i=1; i<=8; i++)
			brushes.push(Brush.Circle(i, true, [`●${i}`, `round ${i}×${i}`]))
		brushes.push(new Brush(new Point(2.5,0.5), [[0, 0, 5, 1]], 5, false, ["—5", "a"]))
		brushes.push(new Brush(new Point(2.5,2.5), [
			[0,0,1,1],// wonder if we should store these as like, DOMRect?
			[1,1,1,1],
			[2,2,1,1],
			[3,3,1,1],
			[4,4,1,1],
		], 5, false, ["╲5", "a"]))
		
		// ╱
		// we can't enable diagonal on this brush, since
		// it's too thin. but technically, diagonal should work on some axes. would be nice to like, say, ok you're allowed to move in these directions:
		// [][]  
		// []()[]
		//   [][]
		// this would not be too hard to implement, either. we just pick the 2 points that straddle the line being drawn
		// (we could even do like, a dashed line? by allowing only movements of 2px at a time?)
		brushes.push(new Brush(new Point(0.5,2.5), [[0, 0, 1, 5]], 5, false, ["| 5", "a"]))
		brushes.push(new Brush(new Point(2.5,2.5), [
			[4,0,1,1],// wonder if we should store these as like, DOMRect?
			[3,1,1,1],
			[2,2,1,1],
			[1,3,1,1],
			[0,4,1,1],
		], 5, false, ["╱5", "a"]))
		brushes.push(new ImageBrush(new Point(0,0), null, false, false, ["📋", "clipboard"]))
		brushes.push(new ImageBrush(new Point(0,0), null, true, false, ["📋", "clipboard (colorized)"]))
		/// define patterns ///
		const patterns = []
		const solid = new String('black')
		solid._label = ["◼", "solid"]
		patterns.push(solid)
		// todo: ooh we can just have a text input for this format!
		for (const str of [
			"#.", "#..", "#...", // vertical lines
			"#.../..#.", // honeycomb
			"#../.#./..#", // diagonal lines
			"#.../.#../..#./...#", // diagonal lines
			"##../##../..##/..##", // big checkerboard
			// ordered dithering:
			"#.../..../..../....",
			"#.../..../..#./....",
			"#.#./..../..#./....",
			"#.#./..../#.#./....", // grid
			"#.#./.#../#.#./....",
			"#.#./.#../#.#./...#",
			"#.#./.#.#/#.#./...#",
			"#.#./.#.#/#.#./.#.#", //checker
			"###./.#.#/#.#./.#.#",
			"###./.#.#/#.##/.#.#",
			"####/.#.#/#.##/.#.#",
			"####/.#.#/####/.#.#", // grid
			"####/##.#/####/.#.#",
			"####/##.#/####/.###",
			"####/####/####/.###",
		]) {
			patterns.push(make_pattern(str, "(dither)", this.grp.c2d))
		}
		const cb = make_pattern('.', 'clipboard', this.grp.c2d)
		cb._label = ["📋", "clipboard"]
		patterns.push(cb)
		
		this.choices = {
			tool: new Choices(
				'tool', [
					tools.Pen, tools.Slow, tools.Line, tools.Spray,
					tools.Flood, tools.Place, tools.Move, tools.Copy, tools.SuperMove, tools.LinkedMove
				],
				v=>this.tool = v,
				v=>v.label
			),
			color: new Choices(
				'color', [
					'#000000','#ffffff','#ff0000','#2040ee','#00cc00','#ffff00','#ee22ee','#00ffff',
					'#555555','#aaaaaa','#aa0000','#8800ff','#ee9900','#aa5544','#aaffbb','#eebbff'
				].slice(0, this.palsize), //"#000000","#FFFFFF","#ca2424","#7575e8","#25aa25","#ebce30"
				(v,i)=>{
					this.color = i
					this.panels.map(panel => panel.map(layer => layer.color = v))
					//this.grp.color = v
					this.form.pick.value = v
				},
				(v,i)=>{
					const label = document.createElement('div')
					label.style.color = `var(--color-${i})`
					return [label, v]
				}
			),
			brush: new Choices(
				'brush', brushes,
				v=>this.panels.map(panel => panel.map(layer => layer.brush = v)),
				//v=>this.grp.brush = v,
				v=>v.label
			),
			pattern: new Choices(
				'pattern', patterns,
				v=>this.panels.map(panel => panel.map(layer => layer.pattern = v)),
				//v=>this.grp.pattern = v,
				v=>v._label
			),
			composite: new Choices(
				'composite', ['source-over', 'destination-over', 'source-atop', 'destination-out', 'xor'],
				// messy, we need to have a nicer way to like, keep track of the labels idk.. associate with values etc,
				v=>this.panels.map(panel => panel.map(layer => layer.composite = v)),
				//v=>this.grp.composite = v,
				v=>({
					'source-over':["over"],
					'destination-over':["under"],
					'source-atop':["in"],
					'destination-out':["erase"],
					'destination-atop':["??"],
					'xor':["xor"],
					'copy':["copy"], // this is only useful when pasting
				}[v])
			),
			invert: new Choices(
				'invert', [false, true],
				v=>this.panels.map(panel => panel.map(layer => layer.invert = v)),
				//v=>this.grp.invert = v,
				v=>v?['invert']:['no']
			),
		}
		
		const pick_color = (picked)=>{
			let sel = this.sel_color()
			const old = this.choices.color.values[sel]
			this.history.add()
			this.panels.map(panel => panel.map(layer => layer.replace_color(old, picked)))
			this.grp.mirror_thumb()
			retrace()
			//this.grp.replace_color(old, picked)
			this.set_palette(sel, picked)
		}
		// safari hack
		let picked = null
		const safari = navigator.vendor=="Apple Computer, Inc."
		
		const layerchange = (d)=>{
			layerset((this.activelayer + (d || 1) + this.layers.length) % this.layers.length)
		}
		const layerset = (d)=>{
			this.activelayer = d
			this.grp = this.layers[this.activelayer]
			//this.grp.thumbcanvas.scrollIntoView({block: 'nearest', inline: 'nearest'})
			cc.scrollTop = Math.max(0,this.grp.thumbcanvas.parentElement.offsetTop + this.grp.thumbcanvas.parentElement.offsetHeight / 2 - cc.clientHeight / 2)
			chatdraw.form.children[2].firstChild.textContent = `Layers: ${this.activelayer+1}/${this.layers.length}`
			//chatdraw.form.layer.nextElementSibling.textContent = `${this.activelayer+1}/${this.layers.length}`
			this.layers.forEach((layer, index) => {
				if (this.focus) {
					layer.canvas.classList.toggle("main", this.activelayer == index)
					layer.canvas.classList.toggle("hide", this.activelayer != index)
				}
				layer.thumbcanvas.classList.toggle("selected", this.activelayer == index)
			})
			this.panels.forEach((panel, index) => {
				panel[0].panelcanvas.parentElement.classList.toggle("selected", this.activepanel == index)
			})
		}
		
		const panelchange = (d)=>{
			panelset((this.activepanel + (d || 1) + this.panels.length) % this.panels.length)
		}
		const panelset = (d)=>{
			this.activelayer = 0
			this.activepanel = d
			this.layers = this.panels[this.activepanel]
			this.grp = this.layers[this.activelayer]
			reloadlayers()
			retrace()
			//this.grp.thumbcanvas.scrollIntoView({block: 'nearest', inline: 'nearest'})
			cc.scrollTop = Math.max(0,this.grp.thumbcanvas.offsetTop + this.grp.thumbcanvas.offsetHeight / 2 - cc.clientHeight / 2)
			ccc.scrollTop = Math.max(0,this.grp.panelcanvas.offsetTop + this.grp.panelcanvas.offsetHeight / 2 - ccc.clientHeight / 2)
			chatdraw.form.children[2].firstChild.textContent = `Layers: ${this.activelayer+1}/${this.layers.length}`
			chatdraw.form.children[16].firstChild.textContent = `Panels: ${this.activepanel+1}/${this.panels.length}`
			//chatdraw.form.layer.nextElementSibling.textContent = `${this.activelayer+1}/${this.layers.length}`
			this.layers.forEach((layer, index) => {
				if (this.focus) {
					layer.canvas.classList.toggle("main", this.activelayer == index)
					layer.canvas.classList.toggle("hide", this.activelayer != index)
				}
				layer.thumbcanvas.classList.toggle("selected", this.activelayer == index)
			})
			this.panels.forEach((panel, index) => {
				panel[0].panelcanvas.parentElement.classList.toggle("selected", this.activepanel == index)
			})
			reloadlayersettings()
		}
		
		/// define button actions ///
		// this is kinda messy why do we have to define these in 2 places..
		const actions = {
			pick: color=>{
				if (safari)
					picked = color
				else
					pick_color(color)
			},
			color: i=>{
				//if (this.color==i && i<this.palsize)
				//	this.form.pick.click() // showPicker()?
			},
			reset: ()=>{
				this.history.add()
				this.grp.erase()
				this.grp.mirror_thumb()
			},
			fill: ()=>{
				this.history.add()
				this.grp.clear()
				this.grp.mirror_thumb()
			},
			bg: ()=>{
				// color here should this.c2d.shadowColor but just in case..
				const sel = this.sel_color()
				if (sel<this.palsize) {
					const color = this.choices.color.values[sel]
					this.history.add()
					this.grp.replace_color(color)
					this.grp.mirror_thumb()
				}
			},
			undo: ()=>this.history.do(false),
			redo: ()=>this.history.do(true),
			save: ()=>{
				const url = this.grp.export()
				console.log(url)
				download(url, `chatdraw-${url.match(/[/](\w{5})/)?.[1]}.png`)
			},
			saveall: ()=>{
				let temp = new Grp(this.width * this.panels.length, this.height)
				let mask = new Grp(this.width, this.height)
				temp.c2d.globalCompositeOperation = 'source-over'
				//temp.c2d.fillStyle = '#FFFFFF'
				temp.c2d.resetTransform()
				mask.c2d.resetTransform()
				this.panels.forEach((panel, index) => {
					panel.forEach(layer => {
						//mask.c2d.clearRect()
						mask.c2d.globalCompositeOperation = 'copy'
						let mid = Number(layer.masksel.value)
						if (0 < mid && mid <= panel.length) {
							mask.c2d.drawImage(panel[mid - 1].canvas, 0, 0)
							mask.c2d.globalCompositeOperation = 'source-in'
						}
						mask.c2d.drawImage(layer.canvas, 0, 0)
						temp.c2d.globalAlpha = layer.opacity.value / 100
						temp.c2d.drawImage(mask.canvas, this.width * index, 0)
					})
				})
				temp.c2d.globalAlpha = 1
				temp.c2d.fillStyle = '#00FFFFFF'
				temp.c2d.fillRect(0, 0, this.width * this.panels.length, 0)
				/*this.layers.forEach(layer => {
					temp.c2d.drawImage(layer.canvas, 0, 0)
				})*/
				const url = temp.export()
				download(url, `chatdraw-${url.match(/[/](\w{5})/)?.[1]}.png`)
			},
			savelayers: ()=>{
				let count = Math.max(...this.panels.map(panel => panel.length))
				let temp = new Grp(this.width * this.panels.length, this.height * count + 1)
				temp.c2d.globalCompositeOperation = 'source-over'
				temp.c2d.resetTransform()
				this.panels.forEach((panel, index) => {
					panel.forEach((layer, i) => {
						temp.c2d.drawImage(layer.canvas, this.width * index, this.height * i)
					})
					temp.c2d.fillStyle = `rgb(${panel.length},0,0)`
					temp.c2d.fillRect(this.width * index, this.height * count, 1, 1)
				})
				/*this.layers.forEach((layer, i) => {
					temp.c2d.drawImage(layer.canvas, 0, this.height * i)
				})*/
				const url = temp.export()
				download(url, `chatdraw-${url.match(/[/](\w{5})/)?.[1]}.png`)
			},
			load: async (v,e)=>{
				let file = e.files[0]
				if (!file)
					return
				let url = URL.createObjectURL(file)
				try {
					let img = new Image()
					img.src = url
					await img.decode()
					this.history.add()
					this.import(img)
					this.grp.mirror_thumb()
				} finally {
					URL.revokeObjectURL(url)
				}
			},
			loadlayers: async (v,e)=>{
				let file = e.files[0]
				let temp = new Grp(1,1)
				temp.c2d.resetTransform()
				if (!file)
					return
				let url = URL.createObjectURL(file)
				try {
					let img = new Image()
					img.src = url
					await img.decode()
					this.history.add()
					let panels = Math.max((img.width / this.width) | 0, 1)
					let max = Math.max((img.height / this.height) | 0, 1)
					this.panels = []
					for (let j=0;j<panels;j++) {
						this.layers = []
						//temp.c2d.drawImage(img, 0, 0, 1, 1)
						temp.c2d.drawImage(img, this.width * j, this.height * max, 1, 1, 0, 0, 1, 1)
						let data = temp.c2d.getImageData(0,0,1,1)
						let layers = data.data[0]
						if (!layers) layers = max
						while (this.layers.length<layers) {
							this.layers.push(new Grp(this.width, this.height))
						}
						for (let i=0;i<layers;i++) {
							this.layers[i].c2d.drawImage(img, this.width*j, this.height*i, this.width, this.height, (this.width * 5), 0, this.width, this.height)
							this.layers[i].replace_color('#e4d8a9', null)
							this.layers[i].mirror_thumb()
						}
						this.panels.push(this.layers)
					}
					this.panels.map(panel => panel.map(layer => layer.copy_settings_layer(this.grp)))
					this.set_palette2(this.all_palette(this.palsize))
					//this.panels = dupe(this.panels, this.activepanel, this.layers)
					reloadlayers()
					panelset(0)
					
				} finally {
					URL.revokeObjectURL(url)
				}
			},
			add: ()=>{
				this.history.add()
				let lay = new Grp(this.width, this.height)
				lay.copy_settings_layer(this.grp)
				//lay.id = "layer" + (this.layers.length + 1)
				this.layers = [...this.layers, lay]
				this.panels = dupe(this.panels, this.activepanel, this.layers)
				reloadlayers()
				layerset(this.layers.length-1)
			},
			remove: ()=>{
				if (this.layers.length == 1) return
				this.history.add()
				this.layers = this.layers.filter(layer => layer != this.grp)
				this.panels = dupe(this.panels, this.activepanel, this.layers)
				reloadlayers()
				layerset(Math.min(this.activelayer,this.layers.length-1))
			},
			clone: ()=>{
				this.history.add()
				let lay = new Grp(this.width, this.height)
				lay.copy_settings_layer(this.grp)
				lay.put_data(this.grp.get_data())
				lay.groupsel.value = this.grp.groupsel.value
				lay.opacity.value = this.grp.opacity.value
				lay.visible.checked = this.grp.visible.checked
				lay.masksel.value = this.grp.masksel.value
				this.layers = [...this.layers, lay]
				this.panels = dupe(this.panels, this.activepanel, this.layers)
				reloadlayers()
				reloadlayersettings()
				layerset(this.layers.length-1)
			},
			focus: ()=>{
				this.focus = !this.focus
				if (this.focus) {
					chatdraw.form.focus.checked = true
					this.layers.forEach((layer, index) => {
						layer.canvas.classList.toggle("main", this.activelayer == index)
						layer.canvas.classList.toggle("hide", this.activelayer != index)
					})
				} else {
					chatdraw.form.focus.checked = false
					this.layers.forEach((layer, index) => {
						layer.canvas.classList.toggle("main", index == 0)
						layer.canvas.classList.toggle("hide", false)
					})
				}
			},
			shiftup: ()=>{
				if ((this.activelayer) == 0) return
				this.history.add()
				let swapper = this.layers[this.activelayer].get_data()
				let swappee = this.layers[this.activelayer - 1].get_data()
				this.layers[this.activelayer].put_data(swappee)
				this.layers[this.activelayer - 1].put_data(swapper)
				
				let group_a = this.layers[this.activelayer].groupsel.value
				let group_b = this.layers[this.activelayer - 1].groupsel.value
				this.layers[this.activelayer].groupsel.value = group_b
				this.layers[this.activelayer - 1].groupsel.value = group_a
				
				let opacity_a = this.layers[this.activelayer].opacity.value
				let opacity_b = this.layers[this.activelayer - 1].opacity.value
				this.layers[this.activelayer].opacity.value = opacity_b
				this.layers[this.activelayer - 1].opacity.value = opacity_a
				
				let visible_a = this.layers[this.activelayer].visible.checked
				let visible_b = this.layers[this.activelayer - 1].visible.checked
				this.layers[this.activelayer].visible.checked = visible_b
				this.layers[this.activelayer - 1].visible.checked = visible_a
				
				// To-do: make it so the layer id gets updated. is this feasible?
				let mask_a = this.layers[this.activelayer].masksel.value
				let mask_b = this.layers[this.activelayer - 1].masksel.value
				this.layers[this.activelayer].masksel.value = mask_b
				this.layers[this.activelayer - 1].masksel.value = mask_a
				reloadlayersettings()
				layerchange(-1)
			},
			shift: ()=>{
				if ((this.activelayer + 1) == this.layers.length) return
				this.history.add()
				let swapper = this.layers[this.activelayer].get_data()
				let swappee = this.layers[this.activelayer + 1].get_data()
				this.layers[this.activelayer].put_data(swappee)
				this.layers[this.activelayer + 1].put_data(swapper)
				
				let group_a = this.layers[this.activelayer].groupsel.value
				let group_b = this.layers[this.activelayer + 1].groupsel.value
				this.layers[this.activelayer].groupsel.value = group_b
				this.layers[this.activelayer + 1].groupsel.value = group_a
				
				let opacity_a = this.layers[this.activelayer].opacity.value
				let opacity_b = this.layers[this.activelayer + 1].opacity.value
				this.layers[this.activelayer].opacity.value = opacity_b
				this.layers[this.activelayer + 1].opacity.value = opacity_a
				
				let visible_a = this.layers[this.activelayer].visible.checked
				let visible_b = this.layers[this.activelayer + 1].visible.checked
				this.layers[this.activelayer].visible.checked = visible_b
				this.layers[this.activelayer + 1].visible.checked = visible_a
				
				let mask_a = this.layers[this.activelayer].masksel.value
				let mask_b = this.layers[this.activelayer + 1].masksel.value
				this.layers[this.activelayer].masksel.value = mask_b
				this.layers[this.activelayer + 1].masksel.value = mask_a
				reloadlayersettings()
				layerchange(1)
			},
			selectup: ()=>{
				layerchange(-1)
			},
			select: ()=>{
				layerchange(1)
			},
			horflip: ()=>{
				this.history.add()
				this.grp.flip()
				this.grp.mirror_thumb()
			},
			verflip: ()=>{
				this.history.add()
				this.grp.flop()
				this.grp.mirror_thumb()
			},
			hormirror: ()=>{
				this.flip = !this.flip
				c.classList.toggle("flip", this.flip)
			},
			vermirror: ()=>{
				this.flop = !this.flop
				c.classList.toggle("flop", this.flop)
			},
			padd: ()=>{
				this.history.add()
				let lay = new Grp(this.width, this.height)
				lay.copy_settings_layer(this.grp)
				this.panels = [...this.panels, [lay]]
				reloadlayers()
				panelset(this.panels.length-1)
			},
			premove: ()=>{
				if (this.panels.length == 1) return
				this.history.add()
				this.panels = this.panels.filter(panel => panel != this.layers)
				//this.panels = dupe(this.panels, this.activepanel, this.layers)
				reloadlayers()
				panelset(Math.min(this.activepanel,this.panels.length-1))
			},
			pclone: ()=>{
				this.history.add()
				let lays = this.layers.map((layer, index) => {
					let lay = new Grp(this.width, this.height)
					lay.copy_settings_layer(this.grp)
					lay.put_data(layer.get_data())
					lay.groupsel.value = layer.groupsel.value
					lay.opacity.value = layer.opacity.value
					lay.visible.checked = layer.visible.checked
					lay.masksel.value = layer.masksel.value
					return lay
				})
				this.panels = [...this.panels, lays]
				reloadlayers()
				panelset(this.panels.length-1)
			},
			pshiftup: ()=>{
				if ((this.activepanel) == 0) return
				this.history.add()
				let panels = [...this.panels]
				let swapper = this.panels[this.activepanel]
				let swappee = this.panels[this.activepanel - 1]
				panels[this.activepanel] = swappee
				panels[this.activepanel - 1] = swapper
				this.panels = panels
				panelchange(-1)
			},
			pshift: ()=>{
				if ((this.activepanel + 1) == this.panels.length) return
				this.history.add()
				let panels = [...this.panels]
				let swapper = this.panels[this.activepanel]
				let swappee = this.panels[this.activepanel + 1]
				panels[this.activepanel] = swappee
				panels[this.activepanel + 1] = swapper
				this.panels = panels
				panelchange(1)
			},
			pselectup: ()=>{
				panelchange(-1)
			},
			pselect: ()=>{
				panelchange(1)
			},
			trace: ()=>{
				this.trace = (this.trace + 1) % 5
				this.form.trace.nextElementSibling.textContent = `trace\n${"◆".repeat(this.trace).padEnd(4,"◇")}`
				retrace()
			},
			speed: ()=>{
				this.speed = (this.speed + 1) % 4
				this.form.speed.nextElementSibling.textContent = `speed\n${"▶".repeat(this.speed).padEnd(3,"▷")}`
			},
			play: ()=>{
				this.play = !this.play
				if (this.play && !this.playing) {
					this.playing = true
					this.timer = 60 - this.speed * 18
					panelset(0)
					requestAnimationFrame(animate)
				}
			}
		}
		
		const animate = () => {
			this.timer--;
			if (this.timer<0){
				this.timer = 60 - this.speed * 18
				panelchange(1)
			}
			if (this.play) {
				requestAnimationFrame(animate)
			}
			else {
				this.playing = false
			}
		}
		
		// todo: put this.img somewhere?
		this.img.oncontextmenu = ev=>{
			this.img.src = this.grp.export()
		}
		
		/// draw form ///
		this.form = draw_form(this.choices, actions, [
			{title:"Action", cols: 2, items:[
				{name:'undo', label:["↶","undo",true]},
				{name:'redo', label:["↷","redo",true]},
				{name:'reset', label:["reset","reset"]},
				{name:'saveall', label:["export", "save all layers as one"]},
				{name:'savelayers', label:["save", "save all layers"]},
				{name:'loadlayers', type:'file', label:["load", "load all layers"]},
				{name:'save', label:["save\nlayer", "save this layer"]},
				{name:'load', type:'file', label:["load\nlayer", "load on this layer"]},
				{name:'hormirror', label:["view⇔","mirror the image horizontally"]},
				{name:'vermirror', label:["view⇕","mirror the image vertically"]},
			]},
			{title:`Layers: ${this.activelayer+1}/${this.layers.length}`, cols: 2, items:[
				{name:'add', label:["+", "add layer", true]},
				{name:'selectup', label:["▲", "select previous layer"]},
				{name:'remove', label:["–", "remove layer", true]},
				{name:'select', label:["▼", "select next layer"]},
				{name:'shiftup', label:["shift↑", "shift layer up"]},
				{name:'clone', label:["clone", "clone the current layer"]},
				{name:'shift', label:["shift↓", "shift layer down"]},
				{name:'focus', label:["focus", "focus on current layer"]},
				{name:'horflip', label:["flip⇔","flip the layer horizontally",false]},
				{name:'verflip', label:["flip⇕","flip the layer vertically",false]},
			]},
			{title:"Tool", cols: 2, items:[
				...this.choices.tool.buttons,
				{name:'fill', label:["fill","fill screen"]},
			]},
			{title:"Shape", small:true, items:this.choices.brush.buttons},
			{title:"Composite", cols: 1, items:this.choices.composite.buttons},
			{title:"Color", cols:((this.palsize < 12) ? 2 : 3), items:[
				...this.choices.color.buttons,
				{name:'pick', type:'color', label:["edit","edit color"]},
				{name:'bg', label:["➙bg","replace color with background"]},
			]},
			{title:"Invert", cols:1, items:this.choices.invert.buttons},
			{title:"Pattern", small:true, items:this.choices.pattern.buttons},
			{title:`Panels: ${this.activepanel+1}/${this.panels.length}`, cols: 2, items:[
				{name:'padd', label:["+", "add panel", true]},
				{name:'pselectup', label:["▲", "select previous panel"]},
				{name:'premove', label:["–", "remove panel", true]},
				{name:'pselect', label:["▼", "select next panel"]},
				{name:'pshiftup', label:["shift↑", "shift panel up"]},
				{name:'pclone', label:["clone", "clone the current panel"]},
				{name:'pshift', label:["shift↓", "shift panel down"]},
				{name:'trace', label:["trace\n◇◇◇◇", "show afterimages of previous panels"]},
				{name:'play', label:["play", "preview all panels as animation"]},
				{name:'speed', label:["speed\n▷▷▷", "change the preview speed"]},
			]},
		])
		
		this.form.hormirror.type = "checkbox"
		this.form.vermirror.type = "checkbox"
		this.form.focus.type = "checkbox"
		this.form.play.type = "checkbox"
		
		
		if (safari)
			this.form.pick.onblur = this.form.pick.onfocus = ev=>{
				if (picked)
					pick_color(picked)
				picked = null
			}
		
		/// undo buffer ///
		this.history = new Undo(
			50,
			(prevsel,prevselpanel)=>({
				//data: this.layers.map(layer => layer.get_data()),
				data: this.panels.map(panel => panel.map(layer => layer.get_data())),
				groups: this.panels.map(panel => panel.map(layer => layer.groupsel.value)),
				alpha: this.panels.map(panel => panel.map(layer => layer.opacity.value)),
				visibles: this.panels.map(panel => panel.map(layer => layer.visible.checked)),
				masks: this.panels.map(panel => panel.map(layer => layer.masksel.value)),
				//data: this.grp.get_data(),
				palette: this.choices.color.values.slice(0, this.palsize),
				layers: this.layers,
				panels: this.panels,
				selected: prevsel == undefined ? this.activelayer : prevsel,
				selectedpanel: prevselpanel == undefined ? this.activepanel : prevselpanel
			}),
			(data)=>{
				if (this.panels != data.panels) {
					this.panels = [...data.panels]
					reloadlayers()
				}
				/*else if (this.panels[data.selectedpanel] != data.layers) {
					//this.layers.filter(layer => !data.layers.includes(layer)).forEach(layer => )
					this.layers = [...data.layers]
					this.panels = dupe(this.panels, this.activepanel, this.layers)
					reloadlayers()
					console.log("somehow used old layer/panel change")
				}*/
				//data.data.forEach((layer, index) => this.panels[data.selectedpanel][index].put_data(layer))
				data.data.forEach((layers, panel) => layers.forEach((layer, index) => this.panels[panel][index].put_data(layer)))
				data.groups.forEach((layers, panel) => layers.forEach((group, index) => this.panels[panel][index].groupsel.value = group))
				data.alpha.forEach((layers, panel) => layers.forEach((alpha, index) => this.panels[panel][index].opacity.value = alpha))
				data.visibles.forEach((layers, panel) => layers.forEach((visible, index) => this.panels[panel][index].visible.value = visible))
				data.masks.forEach((layers, panel) => layers.forEach((mask, index) => this.panels[panel][index].masksel.value = mask))
				//this.layers.put_data(data.data)
				//this.grp.put_data(data.data)
				this.set_palette2(data.palette)
				panelset(data.selectedpanel)
				layerset(data.selected)
				reloadlayersettings()
			},
			(can_undo, can_redo)=>{
				this.form.undo.disabled = !can_undo
				this.form.redo.disabled = !can_redo
			}
		)
		/// final preparations ///
		this.set_palette2(this.choices.color.values)
		this.layers.map(layer => layer.erase())
		//this.grp.erase()
		
		let c = document.createElement('div')
		c.style.setProperty('--width', this.width)
		c.style.setProperty('--height', this.height)
		c.style.textAlign = "center"
		c.className = 'canvas'
		c.append(this.traced.canvas, ...this.panels[this.activepanel].map(layer => layer.canvas), this.overlay.canvas)
		//c.append(...this.layers.map(layer => layer.canvas), this.overlay.canvas)
		c.style.cursor = make_cursor(3)
		
		let cc = document.createElement('div')
		/*cc.style.setProperty('--width', this.width/4)
		cc.style.setProperty('--height', this.height/4)*/
		cc.style.textAlign = "center"
		cc.className = 'thumbs'
		//cc.append(...this.layers.map(layer => layer.thumbcanvas))
		
		let ccc = document.createElement('div')
		/*ccc.style.setProperty('--width', this.width/4)
		ccc.style.setProperty('--height', this.height/4)*/
		ccc.style.textAlign = "center"
		ccc.className = 'panels'
		
		let lp = document.createElement('div')
		lp.className = "lpcontainer"
		lp.append(cc, ccc)
		lp.style.setProperty('--width', this.width/4)
		lp.style.setProperty('--height', this.height/4)
		//lp.style.textAlign = "center"
		
		const opacitychange = (e) => {
			//e.target.parentElement.parentElement._layer.canvas.style.setProperty('opacity', e.target.value + "%")
			e.target.parentElement.parentElement._layer.canvas.style.setProperty('filter', "opacity(" + e.target.value + "%)")
		}
		
		const visibilitychange = (e) => {
			e.target.parentElement._layer.canvas.style.setProperty('visibility', e.target.checked ? 'visible' : 'hidden')
		}
		
		const maskchange = (e) => {
			e.target.parentElement.parentElement._layer.canvas.style.setProperty('mask-image', Number(e.target.value) ? `-moz-element(#layer${e.target.value})` : "unset")
		}
		
		const reloadlayersettings = () => {
			this.layers.forEach((layer, index) => {
				//layer.canvas.id = "layer" + index
				//layer.canvas.style.setProperty('opacity', layer.opacity.value + "%")
				layer.canvas.style.setProperty('filter', "opacity(" + layer.opacity.value + "%)")
				layer.canvas.style.setProperty('visibility', layer.visible.checked ? 'visible' : 'hidden')
				layer.canvas.style.setProperty('mask-image', Number(layer.masksel.value) ? `-moz-element(#layer${layer.masksel.value})` : "unset")
				//layer.canvas.style.setProperty('mask-image', index ? `-moz-element(#layer${index-1})` : "unset")
			})
		}
		
		let layeropts = (layer) => {
			let box = document.createElement('div')
			box.className = "layeropt"
			box._layer = layer
			let sets = document.createElement('div')
			sets.className = "layersetting"
			sets.append(layer.opacity, layer.groupsel, layer.masksel)
			box.append(layer.thumbcanvas, layer.visible, sets)
			layer.opacity.onchange = opacitychange
			layer.visible.onchange = visibilitychange
			layer.masksel.onchange = maskchange
			return box
		}
		
		cc.append(...this.layers.map(layer => layeropts(layer)))
		
		let containerize = (panels) => {
			let container = document.createElement('div')
			container.className = "panel"
			container.append(...panels)
			container.targetPanel = panels
			return container
		}
		ccc.append(...this.panels.map(panel => containerize(panel.map(layer => layer.panelcanvas))))
		ccc.firstElementChild.classList.add('selected')
		
		const reloadlayers = () => {
			c.textContent = ""
			cc.textContent = ""
			ccc.textContent = ""
			c.append(this.traced.canvas, ...this.layers.map((layer,index) => (layer.canvas.id = "layer" + (index + 1),layer.canvas)), this.overlay.canvas)
			cc.append(...this.layers.map(layer => layeropts(layer)))
			ccc.append(...this.panels.map(panel => containerize(panel.map(layer => layer.panelcanvas))))
		}
		
		const retrace = () => {
			this.traced.erase()
			if (this.trace) {
				let vis = 1
				this.traced.c2d.save()
				this.traced.c2d.globalCompositeOperation = 'source-over'
				this.traced.c2d.resetTransform()
				let temp = new Grp(this.width, this.height)
				temp.c2d.globalCompositeOperation = 'source-over'
				temp.c2d.resetTransform()
				for(let i=this.activepanel-1; i>=Math.max(0,this.activepanel-this.trace); i--) {
					temp.erase()
					for (let j=0;j<this.panels[i].length;j++) {
						if (!this.panels[i][j].visible.checked) continue
						temp.c2d.globalAlpha = this.panels[i][j].opacity.value / 100
						temp.c2d.drawImage(this.panels[i][j].canvas, 0, 0, this.width, this.height)
					}
					vis *= .7
					this.traced.c2d.globalAlpha = vis
					this.traced.c2d.drawImage(temp.canvas, 0, 0, this.width, this.height)
					//this.traced.c2d.drawImage(this.panels[0][0].canvas, 0, 0, this.width, this.height)
				}
				this.traced.c2d.restore()
			}
		}
		
		cc.addEventListener("click", (e) => {
			if (e.target.nodeName != "CANVAS") return
			layerset(this.layers.findIndex(layer => layer.thumbcanvas == e.target))
		})
		
		ccc.addEventListener("click", (e) => {
			let elem = e.target.nodeName == "DIV" ? e.target : e.target.parentElement
			if (elem.nodeName != "DIV") return
			panelset(this.panels.findIndex(panel => panel[0].panelcanvas == elem.targetPanel[0]))
		})
		
		Stroke.handle(c, ev=>{
			if (ev.button)
				return
			if (this.play)
				return
			this.history.add()
			this.tool.PointerDown(ev, this.grp.canvas, this.grp, this.overlay, this)
		})
		
		//c.addEventListener("pointerup", () => {
		//	console.log("boo!")
		//})
		
		super.attachShadow({mode: 'open'}).append(
			...ChatDraw.styles.map(x=>document.importNode(x, true)),
			c, /*cc, ccc,*/ lp, this.form
		)
		
		document.body.onkeydown = (e) => {
			if (e.ctrlKey && e.target == document.body) {
				if (e.code == "KeyZ") {
					if (!e.shiftKey) {
						this.form.undo.click()
					}
					else {
						this.form.redo.click()
					}
				} else if (e.code == "KeyY") {
					this.form.redo.click()
				}
			}
		}
		
		this.form.onkeydown = e => {
			if (e.ctrlKey) {
				if (e.code == "KeyZ") {
					if (!e.shiftKey) {
						this.form.undo.click()
					}
					else {
						this.form.redo.click()
					}
				} else if (e.code == "KeyY") {
					this.form.redo.click()
				}
			}
		}
		
		this.choose('tool', 0)
		this.choose('brush', 1)
		this.choose('composite', 0)
		this.choose('color', 0)
		this.choose('pattern', 0)
		this.choose('invert', 0)
	}
	// idea: what if all tools just draw to the overlay, then we copy to main canvas at the end of the stroke? and update undo buffer..
	// ugh but that would be slow maybe?
	
	connectedCallback() {
	}
	
	when_copy(data) {
		const c = document.createElement('canvas')
		c.width = data.width
		c.height = data.height
		const c2d = c.getContext('2d')
		c2d.putImageData(data, 0, 0)
		this.clipboard = c
		
		this.choose('tool', 5) // prevent accidental overwriting
		
		// URGENT TODO: setting values like this wont update the current value if its already selected
		// todo: better way of setting these that doesnt rely on hardcoded button location index?
		const pv = this.choices.pattern.values
		pv[pv.length-1] = this.grp.c2d.createPattern(c, 'repeat')
		
		const bv = this.choices.brush.values, bl = bv.length-1
		bv[bl].set_image(c)
		bv[bl-1].set_image(c)
		this.choose('brush', bl-1)
	}
	
	set_scale(n) {
		this.style.setProperty('--S', n)
	}
	
	set_scalecanvas(n) {
		this.style.setProperty('--SC', n)
		this.grp.canvas.parentElement.classList.toggle("small", n < 1)
	}
	
	set_offset(n) {
		this.style.setProperty('margin-left', n+"px")
	}
	
	centering(checked) {
		this.classList.toggle("centered", checked)
	}
	// todo: allow passing a more useful value here
	choose(name, value) {
		const elem = this.form.querySelector(`input[name="${name}"][value="${value}"]`)
		elem.checked = true
		elem.dispatchEvent(new Event('change', {bubbles:true}))
	}
	set_palette2(colors) {
		for (let i=0; i<this.palsize; i++)
			this.set_palette(i, colors[i]??"#b4b4b4")
	}
	set_palette(i, color) {
		if (i>=this.palsize)
			return
		this.form.style.setProperty(`--color-${i}`, color)
		this.choices.color.values[i] = color
		if (i==this.sel_color())
			this.choices.color.change(i)
		// hack
		const btn = this.form?.querySelector(`input[name="color"][value="${i}"]`)
		if (btn)
			btn.title = color
	}
	// which color index is selected
	sel_color() {
		return this.color
	}
	
	import(img) {
		this.grp.c2d.drawImage(img, (this.width * 5), 0, img.width, img.height)
		this.grp.replace_color('#e4d8a9', null)
		//this.set_palette2(this.grp.get_palette(this.palsize))
		this.set_palette2(this.all_palette(this.palsize))
	}
	
	all_palette(lim) {
		let colors = new Set()
		for (let p=0;p<this.panels.length;p++) {
			for (let l=0;l<this.panels[p].length;l++) {
				const d = this.panels[p][l].get_data().data
				for (let i=0; i<d.length; i+=4)
					if (d[i+3]) {
						colors.add(d[i]<<16|d[i+1]<<8|d[i+2])
						if (colors.size >= lim)
							break
					}
			}
		}
		return [...colors].map(x=>"#"+x.toString(16).padStart(6,"0"))
	}
}
ChatDraw.styles = ['style.css'].map(href=>Object.assign(document.createElement('link'), {rel:'stylesheet', href}))

customElements.define('chat-draw', ChatDraw)
