var localMethods = [];
var delayParsedContexts = [];	//{locationMark:"###1###", context:context}
var isFinishedParsed = false;


/////////////////Base
class JPContext {
	constructor() {
		this.next = null;
        this.pre = null;
        this.currIdx = 0;
        this.id = contextId++;
	}

    parse () {
        return ''
    }

    setNext (ctx) {
        ctx.pre = this;
        if (this.next) {
            this.next.next = ctx;
        } else {
            this.next = ctx;
        }
    }
}

/////////////////JPCommonContext
class JPCommonContext extends JPContext {
	constructor(str) {
		super()
        this.str = str;
	}
    parse () {
        return this.str ? this.str : '';
    }
}

/////////////////JPBridgeContext
class JPBridgeContext extends JPContext {
	constructor () {
		super()
	}
    parse () {
        var ctx = this;
        var script = '';
        while (ctx = ctx.next) {
            script += ctx.parse();
        }
        return script;
    }
}

/////////////////JPClassContext

class JPClassContext extends JPContext {
	constructor () {
		super()
        this.className = '';
        this.instanceMethods = [];
        this.classMethods = [];
        this.ignore = 0;
	}

	parse () {
        var script = this.ignore ? '' : "defineClass('" + this.className + "', {";
        for (var i = 0; i < this.instanceMethods.length; i ++) {
            var separator = this.ignore && this.instanceMethods.length <= 1 ? '': ',';
            script += this.instanceMethods[i].parse() + separator;
            localMethods.push(this.instanceMethods[i].parsedMethodName);
        }
        script += this.ignore ? '' : '}';
        if (this.classMethods.length) {
            script += this.ignore ? '' : ',{';
            for (var i = 0; i < this.classMethods.length; i ++) {
                var separator = this.ignore && this.classMethods.length <= 1 ? '': ','
                script += this.classMethods[i].parse() + separator;
                localMethods.push(this.classMethods[i].parsedMethodName);
            }
            script += this.ignore ? '' : '}'
        }
        script += this.ignore ? '' : ');';

        isFinishedParsed = true;
        for (var i in delayParsedContexts) {
            var locationMark = delayParsedContexts[i]['locationMark'];
            var context = delayParsedContexts[i]['context'];
            script = script.replace(locationMark, context.parse());
        }

        return script;
	}
}

/////////////////JPMethodContext

class JPMethodContext extends  JPContext {
	constructor () {
		super()
        this.names = [];
        this.params = [];
        this.parsedMethodName = ''
        this.ignore = 0;
	}

    parse (){
        var ctx = this;
        var script = ''
        if (!this.ignore) {
            var firstName = this.names[0]
            if (firstName[0] == '_') {
                // 处理下划线开头函数名
                firstName = "_" + firstName;
                this.names[0] = firstName;
            }
            this.parsedMethodName = this.names.join('_');
            script = this.parsedMethodName + ": function(" + this.params.join(',') + ") {"
        }

        while (ctx = ctx.next) {
            script += ctx.parse();
        }
        script += this.ignore ? '' : '}'
        return script;
    }

}

/////////////////JPMsgContext

class JPMsgContext extends JPContext {
	constructor() {
		super()
        this.receiver = null;
        this.selector = [];
        this.parsedSelector = null;
        this.preMsg = null;

        this.argumentIndex = 0;
	}

    parse () {
        var code = this.receiver.parse();
        var funcName = [];
        var params = [];
        for (var i = 0; i < this.selector.length; i ++) {
            funcName.push(this.selector[i].name);
            if (typeof this.selector[i].param == "string") {
                params.push(this.selector[i].param);
            } else if (this.selector[i].param) {
                params.push(this.selector[i].param.parse());
            }
        }

        this.parsedSelector = funcName.join('|__underline__|');
        code += '|__dot__|' + this.parsedSelector + '(' + params.join(',') + ')';
        return code;
    }
}

/////////////////JPParamContext

class JPParamContext extends JPBridgeContext {
	constructor () {
		super();
        this.parent = null;
	}
}

/////////////////JPBlockContext

class JPBlockContext extends JPContext {
	constructor () {
		super()
        this.types = [];
        this.names = [];
        this.msg = null;
        this.content = null;
	}

    parse () {

        var isLocalMethod = false;

        //如果作为参数的block，要等所有的解析完成后，再解析
        if (this.msg) {
            if (!isFinishedParsed) {
                var locationMark = '####' + delayParsedContexts.length + '####';
                delayParsedContexts.push({locationMark: locationMark, context: this});
                return locationMark;
            }
            else {
                var blockSelector = this.msg.parsedSelector;
                for (var i in localMethods) {
                    var selector = localMethods[i];
                    if (selector === blockSelector) {
                        isLocalMethod = true;
                        break;
                    }
                }
            }
        }

        if (isLocalMethod) {
            var script = 'function(' + this.names.join(',') + ') {';
            return script + this.content.parse() + "}";
        }
        else {
            var paramTypes = this.types.length ? "'void, " + this.types.join(',') + "', " : "'void' , ";
            var script = 'block(' + paramTypes + 'function(' + this.names.join(',') + ') {';
            return script + this.content.parse() + "})";
        }

    }
}

class JPBlockContentContext extends JPBridgeContext {
	constructor () {
		super()
        this.parent = null;
	}
}

/////////////////JPAssignContext

class JPAssignContext extends JPContext {
	constructor() {
		super()
        this.left = null;
        this.right = null;
	}
	parse () {
        var leftStr = this.left.parse();
        var leftArr = leftStr.split(/\|__dot__\||\./);
        var lastProperty = leftArr[leftArr.length - 1];
        var firstProperty = leftArr[0];

        if (leftArr.length == 1) {
            if (firstProperty[0] == '_') {
                return 'self' + '|__dot__|' + 'setProp|__underline__|forKey(' + this.right.parse() + ", '" + lastProperty.substr(1).trim() + "')";
            }
            else {
                return firstProperty + ' = ' + this.right.parse();
            }
        }
        else {
            if (/jp|__underline__|element\(.+\)\s*$/gm.test(lastProperty)) {
                lastProperty = lastProperty.replace(/jp|__underline__|element\((.+)\)\s*$/gm, 'setJp|__underline__|element($1,' + this.right.parse() + ')');
            }
            else {
                lastProperty = 'set' + lastProperty[0].toUpperCase() + lastProperty.substr(1) + '(' + this.right.parse() + ')';
            }
            leftArr = leftArr.slice(1, leftArr.length - 1);
            return firstProperty + (leftArr.length > 0 ? '.' : '') + leftArr.join('.') + '|__dot__|' + lastProperty;
        }
    }
}

class JPAssignLeftContext extends JPBridgeContext {
	constructor () {
		super()
        this.parent = null;
	}
}

class JPAssignRightContext extends JPBridgeContext {
	constructor () {
		super()
        this.parent = null;
	}
}

/////////////////JPDeclarationContext

class JPDeclarationContext extends JPContext {
	constructor () {
		super()
        this.parent = null;
	}

    parse (){
        return 'var ';
    }
}

/////////////////JPPostfixContext

class JPPostfixContext extends JPContext {
	constructor () {
		super()
        this.content = null;
	}

    parse () {
        return '|__dot__|jp|__underline__|element(' + this.content.parse() + ')';
    }
}

class JPPostfixContentContext extends JPBridgeContext {
	constructor () {
		super();
        this.parent = null;
	}
}

/////////////////JPForInContext

class JPForInContext extends JPContext {
	constructor () {
		super()
        this.content = null;
        this.variableDeclarator = null;
        this.variableSet = null;
	}
    parse () {
        return 'jp|__underline__|enumerate(' + this.variableSet.parse() + ', function(' + this.variableDeclarator + ')' + this.content.parse() + ');';
    }
}

class JPForInContentContext extends JPBridgeContext {
    constructor () {
        super();
        this.parent = null;
    }
}

class JPForInVariableSetContext extends JPBridgeContext {
    constructor () {
        super();
        this.parent = null;
    }
}

/////////////////JPArrayContext
class JPArrayContext extends JPContext {
    constructor () {
        super()
        this.content = null;
    }
    parse () {
        return "NSArray|__dot__|arrayWithObjects(" + this.content.parse() + ", null)";
    }
}

class JPArrayContentContext extends JPBridgeContext {
    constructor () {
        super()
        this.parent = null;
    }
}

/////////////////JPDictionaryContext
class JPDictionaryContext extends JPContext {
    constructor () {
        super()
        this.content = null;
    }
    parse () {
        return "NSDictionary|__dot__|dictionaryWithObjectsAndKeys(" + this.content.parse() + " null)";
    }
}

class JPDictionaryContentContext extends JPContext {
    constructor () {
        super()
        this.parent = null;
        this.objs = [];
    }
    parse () {
        var result = '';
        for (var index in this.objs) {
            var obj = this.objs[index];
            result += (obj.parse() + ', ');
        }
        return result;
    }
}

class JPDictionaryObjContext extends JPBridgeContext {
    constructor () {
        super()
        this.parent = null;
    }
}

var contextId = 0;
JPContext.prototype.toString = function() {
    return 'JPContext_' + this.id;
}


/////////////////exports

exports.JPCommonContext = JPCommonContext;
exports.JPMsgContext = JPMsgContext;
exports.JPParamContext = JPParamContext;
exports.JPBlockContext = JPBlockContext;
exports.JPBlockContentContext = JPBlockContentContext;
exports.JPAssignContext = JPAssignContext;
exports.JPAssignLeftContext = JPAssignLeftContext;
exports.JPAssignRightContext = JPAssignRightContext;
exports.JPDeclarationContext = JPDeclarationContext;
exports.JPClassContext = JPClassContext;
exports.JPMethodContext = JPMethodContext;
exports.JPPostfixContext = JPPostfixContext;
exports.JPPostfixContentContext = JPPostfixContentContext;
exports.JPForInContext = JPForInContext;
exports.JPForInContentContext = JPForInContentContext;
exports.JPForInVariableSetContext = JPForInVariableSetContext;
exports.JPArrayContext = JPArrayContext;
exports.JPArrayContentContext = JPArrayContentContext;
exports.JPDictionaryContext = JPDictionaryContext;
exports.JPDictionaryContentContext = JPDictionaryContentContext;
exports.JPDictionaryObjContext = JPDictionaryObjContext;
exports.JPBridgeContext = JPBridgeContext;