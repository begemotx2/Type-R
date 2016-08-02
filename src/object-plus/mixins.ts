/**
 * Mixins and @define metaprogramming class extensions
 * 
 * Vlad Balin & Volicon, (c) 2016
 */
import { log, assign, omit, getPropertyDescriptor, getBaseClass, defaults, transform } from './tools'

/**
 * Class definition recognized by `define`
 */
export interface ClassDefinition {
    properties? : PropertyMap | boolean
    mixins? : Mixin[]
    mixinRules? : MixinRules
    [ name : string ] : any
}

interface PropertyMap {
    [ name : string ] : Property
}

type Property = PropertyDescriptor | ( () => any )

type Mixin = Constructor< any > | {}

export interface MixinRules {
    [ propertyName : string ] : MergeRule | MixinRules
}

type MergeRule = 'merge' | 'pipe' | 'sequence' | 'reverse' | 'every' | 'some'


declare function __extends( a, b )

/**
 *  Generic interface to reference constructor function type for any given T. 
 */
export interface Constructor< T >{
    new ( ...args : any[] ) : T
}

/**
 * Generic interface to reference constructor function of any Mixable type T.
 */
export interface MixableConstructor< T > extends Constructor< T >{
    prototype : Mixable
    create( a : any, b? : any, c? : any ) : Mixable
    mixins( ...mixins : ( Constructor<any> | {} )[] ) : MixableConstructor< T >
    mixinRules( mixinRules : MixinRules ) : MixableConstructor< T >
    mixTo( ...args : Constructor<any>[] ) : MixableConstructor< T >
    define( definition : ClassDefinition, staticProps? : {} ) : MixableConstructor< T >
    extend(spec? : ClassDefinition, statics? : {} ) : MixableConstructor< T >
    predefine() : MixableConstructor< T >
}

/**
 * Base class, holding metaprogramming class extensions.
 * Supports mixins, and Class.define metaprogramming method.
 */ 
export class Mixable {

    // Generic class factory. May be overridden for abstract classes. Not inherited.
    static create( a : any, b? : any, c? : any ) : Mixable {
        return new (<any>this)( a, b, c );
    }

    protected static _mixinRules : MixinRules = { properties : 'merge' };

    /**
     * Attach the sequence of mixins to the class prototype.
     * 
     * ```javascript
     *    MyMixableClass.mixins( plainObjMixin, OtherConstructor, ... );
     *    MyOtherClass.mixins([ plainObjMixin, OtherConstructor, ... ]); 
     * ```
     */

    static _appliedMixins : any[]

    static mixins( ...mixins : ( Mixin | Mixin[] )[] ) : typeof Mixable {
        const proto      = this.prototype,
              mergeRules : MixinRules = this._mixinRules || {},      
              _appliedMixins = this._appliedMixins = ( this._appliedMixins || [] ).slice();

        // Apply mixins in sequence...
        for( let mixin of mixins ) {
            // Mixins array should be flattened. 
            if( mixin instanceof Array ) {
                return Mixable.mixins.apply( this, mixin );
            }

            // Don't apply mixins twice.
            if( _appliedMixins.indexOf( mixin ) >= 0 ) continue;

            _appliedMixins.push( mixin );

            // For constructors, merge _both_ static and prototype members.
            if( typeof mixin === 'function' ){
                // Statics are merged by simple substitution.
                defaults( this, mixin );

                // Prototypes are merged according with a rules.
                mergeProps( proto, (<Constructor<any>>mixin).prototype, mergeRules );
            }
            // Handle plain object mixins.
            else {
                mergeProps( proto, mixin, mergeRules );
            }
        }

        return this;
    }

    // Inversion of control version of Class.mixin.
    static mixTo< T >( ...args : Function[] ) : typeof Mixable {
        for( let Ctor of args ) {
            Mixable.mixins.call( Ctor, this );
        }

        return this;
    }

    // Members merging policy is controlled by MyClass.mixinRules property.
    // mixinRules are properly inherited and merged.
    static mixinRules( mixinRules : MixinRules ) : MixableConstructor< Mixable > {
        const Base = Object.getPrototypeOf( this.prototype ).constructor;

        if( Base._mixinRules ) {
            mergeProps( mixinRules, Base._mixinRules );
        }

        this._mixinRules = mixinRules;
        return this;
    }

    /**
     * Main metaprogramming method. May be overriden in subclasses to customize the behavior.   
     * - Merge definition to the prototype.
     * - Add native properties with descriptors from spec.properties to the prototype.
     * - Prevents inheritance of 'create' factory method.
     * - Assign mixinRules static property, and merge it with parent.
     * - Adds mixins.
     */
    static define( definition : ClassDefinition = {}, staticProps? : {} ) : typeof Mixable {
        // That actually might happen when we're using @define decorator... 
        if( !this.define ){
            log.error( "[Class.define] Class must have class extensions to use @define decorator. Use '@extendable' before @define, or extend the base class with class extensions.", definition );
            return this;
        }

        this.predefine();

        // Obtain references to prototype and base class.
        const proto = this.prototype;

        // Extract prototype properties from the definition.
        const protoProps = omit( definition, 'properties', 'mixins', 'mixinRules' ),
            { properties = <PropertyMap> {}, mixins, mixinRules } = definition;

        // Update prototype and statics.
        assign( proto, protoProps );
        assign( this, staticProps );

        // Define native properties.
        properties && Object.defineProperties( proto, transform( {}, <PropertyMap>properties, toPropertyDescriptor ) );

        // Apply mixins and mixin rules.
        mixinRules && this.mixinRules( mixinRules );
        mixins && this.mixins( mixins );

        return this;
    }

    // Backbone-compatible extend method to be used in ES5 and for backward compatibility
    static extend(spec? : ClassDefinition, statics? : {} ) : typeof Mixable {
        let Subclass : typeof Mixable;

        // 1. Create the subclass (ES5 compatibility shim).
        // If constructor function is given...
        if( spec && spec.hasOwnProperty( 'constructor' ) ){
            // ...we need to manually call internal TypeScript __extend function. Hack! Hack!
            Subclass = <any>spec.constructor; 
            __extends( Subclass, this );
        }
        // Otherwise, create the subclall in usual way.
        else{
            Subclass = class Subclass extends this {};
        }

        // 2. Apply definitions
        return spec ? Subclass.define( spec, statics ) : Subclass.predefine();
    }

    // Do the magic necessary for forward declarations.
    // Must be written in the way that it's safe to call twice.
    static predefine() : typeof Mixable {
        const BaseClass : typeof Mixable = getBaseClass( this );

        // Make sure we don't inherit class factories.
        if( BaseClass.create === this.create ) {
            this.create = Mixable.create;
        }

        return this;
    }
}

function toPropertyDescriptor( x : Property ) : PropertyDescriptor {
    if( x ){
        return typeof x === 'function' ? { get : < () => any >x } : <PropertyDescriptor> x;
    }
}

// @mixinRules({ ... }) decorator
export function mixinRules( rules : MixinRules ) {
    return createDecorator( 'mixinRules', rules );
}

// @mixins( A, B, C ) decorator
export function mixins( ...list : {}[] ) {
    return createDecorator( 'mixins', list );
}

// @extendable decorator. Convert class to be an ExtendableConstructor.
export function extendable( Type : Function ) : void {
    Mixable.mixTo( Type );
}

// @predefine decorator for forward definitions. 
export function predefine( Constructor : MixableConstructor< any > ) : void {
    Constructor.predefine();
}

// @define decorator for metaprogramming magic.
export function define( spec : ClassDefinition | MixableConstructor< any > ){
    // Handle the case when @define used without arguments. 
    if( typeof spec === 'function' ){
        ( <MixableConstructor< any >> spec).define({});
    }
    // Normal usage.
    else{
        return createDecorator( 'define', spec );
    }
} 

// Create ES7 class decorator forwarding call to the static class member.
// If there is no such a member, forward the call to Class.
function createDecorator( name : string, spec : {} ){
    return function( Ctor : Function ) : void {
        if( Ctor[ name ] ) {
            Ctor[ name ]( spec );
        }
        else {
            Mixable[ name ].call( Ctor, spec );
        }
    }
}

/***********************
 * Mixins helpers
 */
function mergeObjects( a : {}, b : {}, rules? : MixinRules ) : {} {
    const x = assign( {}, a );
    return mergeProps( x , b, rules );
}

interface IMergeFunctions {
    [ name : string ] : ( a : Function, b : Function ) => Function
}

const mergeFunctions : IMergeFunctions = {
    pipe< A, B, C >( a: ( x : B ) => C, b : ( x : A ) => B ) : ( x : A ) => C {
        return function( x : A ) : C {
            return a.call( this, b.call( this, x ) );
        }
    },

    sequence( a : Function, b : Function ){
        return function() : void {
            a.apply( this, arguments );
            b.apply( this, arguments );
        }
    },

    reverse( a : Function, b : Function ){
        return function() : void {
            b.apply( this, arguments );
            a.apply( this, arguments );
        }
    },

    every( a : Function, b : Function ){
        return function() {
            return a.apply( this, arguments ) && b.apply( this, arguments );
        }
    },

    some( a : Function, b : Function ){
        return function() {
            return a.apply( this, arguments ) || b.apply( this, arguments );
        }
    }
};

function mergeProps< T extends {} >( target : T, source : {}, rules : MixinRules = {}) : T {
    for( let name of Object.keys( source ) ) {
        const sourceProp = Object.getOwnPropertyDescriptor( source, name ),
              destProp   = getPropertyDescriptor( target, name ); // Shouldn't be own

        if( destProp ) {
            const rule  = rules[ name ],
                  value = destProp.value;

            if( rule && value ) {
                target[ name ] = typeof rule === 'object' ?
                    mergeObjects( value, sourceProp.value, rule ) :(
                        rule === 'merge' ?
                            mergeObjects( value, sourceProp.value ) :
                            mergeFunctions[ rule ]( value, sourceProp.value )
                    );
            }
        }
        else {
            Object.defineProperty( target, name, sourceProp );
        }
    }

    return target;
}