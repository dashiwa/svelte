import { isIdentifierStart, isIdentifierChar } from 'acorn';
import fragment from './state/fragment';
import { whitespace } from '../utils/patterns';
import reservedNames from '../utils/reservedNames';
import fullCharCodeAt from '../utils/fullCharCodeAt';
import { Node, Ast, CustomElementOptions } from '../interfaces';
import error from '../utils/error';

interface ParserOptions {
	filename?: string;
	bind?: boolean;
	customElement?: CustomElementOptions | true;
}

type ParserState = (parser: Parser) => (ParserState | void);

export class Parser {
	readonly template: string;
	readonly filename?: string;
	readonly customElement: CustomElementOptions | true;

	index = 0;
	stack: Array<Node> = [];

	html: Node;
	css: Node[] = [];
	js: Node[] = [];
	metaTags = {};

	allowBindings: boolean;

	constructor(template: string, options: ParserOptions) {
		if (typeof template !== 'string') {
			throw new TypeError('Template must be a string');
		}

		this.template = template.replace(/\s+$/, '');
		this.filename = options.filename;
		this.customElement = options.customElement;

		this.allowBindings = options.bind !== false;

		this.html = {
			start: null,
			end: null,
			type: 'Fragment',
			children: [],
		};

		this.stack.push(this.html);

		let state: ParserState = fragment;

		while (this.index < this.template.length) {
			state = state(this) || fragment;
		}

		if (this.stack.length > 1) {
			const current = this.current();

			const type = current.type === 'Element' ? `<${current.name}>` : 'Block';
			const slug = current.type === 'Element' ? 'element' : 'block';

			this.error({
				code: `unclosed-${slug}`,
				message: `${type} was left open`
			}, current.start);
		}

		if (state !== fragment) {
			this.error({
				code: `unexpected-eof`,
				message: 'Unexpected end of input'
			});
		}

		if (this.html.children.length) {
			let start = this.html.children[0] && this.html.children[0].start;
			while (/\s/.test(template[start])) start += 1;

			let end = this.html.children[this.html.children.length - 1] && this.html.children[this.html.children.length - 1].end;
			while (/\s/.test(template[end - 1])) end -= 1;

			this.html.start = start;
			this.html.end = end;
		} else {
			this.html.start = this.html.end = null;
		}
	}

	current() {
		return this.stack[this.stack.length - 1];
	}

	acornError(err: any) {
		this.error({
			code: `parse-error`,
			message: err.message.replace(/ \(\d+:\d+\)$/, '')
		}, err.pos);
	}

	error({ code, message }: { code: string, message: string }, index = this.index) {
		error(message, {
			name: 'ParseError',
			code,
			source: this.template,
			start: index,
			filename: this.filename
		});
	}

	eat(str: string, required?: boolean, message?: string) {
		if (this.match(str)) {
			this.index += str.length;
			return true;
		}

		if (required) {
			this.error({
				code: `unexpected-${this.index === this.template.length ? 'eof' : 'token'}`,
				message: message || `Expected ${str}`
			});
		}

		return false;
	}

	match(str: string) {
		return this.template.slice(this.index, this.index + str.length) === str;
	}

	matchRegex(pattern: RegExp) {
		const match = pattern.exec(this.template.slice(this.index));
		if (!match || match.index !== 0) return null;

		return match[0];
	}

	allowWhitespace() {
		while (
			this.index < this.template.length &&
			whitespace.test(this.template[this.index])
		) {
			this.index++;
		}
	}

	read(pattern: RegExp) {
		const result = this.matchRegex(pattern);
		if (result) this.index += result.length;
		return result;
	}

	readIdentifier() {
		const start = this.index;

		let i = this.index;

		const code = fullCharCodeAt(this.template, i);
		if (!isIdentifierStart(code, true)) return null;

		i += code <= 0xffff ? 1 : 2;

		while (i < this.template.length) {
			const code = fullCharCodeAt(this.template, i);

			if (!isIdentifierChar(code, true)) break;
			i += code <= 0xffff ? 1 : 2;
		}

		const identifier = this.template.slice(this.index, this.index = i);

		if (reservedNames.has(identifier)) {
			this.error({
				code: `unexpected-reserved-word`,
				message: `'${identifier}' is a reserved word in JavaScript and cannot be used here`
			}, start);
		}

		return identifier;
	}

	readUntil(pattern: RegExp) {
		if (this.index >= this.template.length)
			this.error({
				code: `unexpected-eof`,
				message: 'Unexpected end of input'
			});

		const start = this.index;
		const match = pattern.exec(this.template.slice(start));

		if (match) {
			this.index = start + match.index;
			return this.template.slice(start, this.index);
		}

		this.index = this.template.length;
		return this.template.slice(start);
	}

	requireWhitespace() {
		if (!whitespace.test(this.template[this.index])) {
			this.error({
				code: `missing-whitespace`,
				message: `Expected whitespace`
			});
		}

		this.allowWhitespace();
	}
}

export default function parse(
	template: string,
	options: ParserOptions = {}
): Ast {
	const parser = new Parser(template, options);

	// TODO we way want to allow multiple <style> tags —
	// one scoped, one global. for now, only allow one
	if (parser.css.length > 1) {
		parser.error({
			code: 'duplicate-style',
			message: 'You can only have one top-level <style> tag per component'
		}, parser.css[1].start);
	}

	return {
		html: parser.html,
		css: parser.css,
		js: parser.js,
	};
}
